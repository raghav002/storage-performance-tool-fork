package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListCatalogArtifacts(t *testing.T) {
	a := newCatalogApp(t)
	run, ok := a.findCatalogRun(fixtureDashboard)
	if !ok {
		t.Fatal("dashboard fixture missing")
	}
	items, err := listCatalogArtifacts(run.dir)
	if err != nil {
		t.Fatal(err)
	}
	byKind := map[string]int{}
	names := map[string]bool{}
	for _, item := range items {
		byKind[item.Kind]++
		names[item.Name] = true
		if item.Type == "" || item.Size <= 0 {
			t.Fatalf("artifact %#v missing type or size", item)
		}
	}
	if !names["dashboard-001-20261021.170103.600-create.messages.log"] {
		t.Fatal("expected messages log")
	}
	if !names["dashboard-001-20261021.170103.600-create.errors.log"] {
		t.Fatal("expected errors log")
	}
	if !names["dashboard-001-20261021.170103.600-create.metrics.csv"] {
		t.Fatal("expected metrics csv")
	}
	if !names["dashboard-001-20261021.170103.600-create.result.xml"] {
		t.Fatal("expected result xml")
	}
	if !names["spt_dashboard-20261021.170103.600_results_summary.txt"] {
		t.Fatal("expected results summary")
	}
	if byKind["csv"] < 2 || byKind["log"] < 2 || byKind["xml"] < 1 {
		t.Fatalf("kinds %#v", byKind)
	}
	// spt_run_params.json and engine.info.json stay hidden (not on the allow-list).
	for _, item := range items {
		if strings.Contains(strings.ToLower(item.Name), "run_params") || strings.Contains(item.Name, "engine.info") {
			t.Fatalf("secret-adjacent file listed: %s", item.Name)
		}
	}
}

func TestHandleCatalogArtifacts(t *testing.T) {
	a := newCatalogApp(t)
	body := catalogGET(t, a, a.handleCatalogArtifacts, "/api/catalog/artifacts?id="+fixtureDashboard, 200)
	arts, ok := body["artifacts"].([]any)
	if !ok || len(arts) == 0 {
		t.Fatalf("artifacts: %#v", body["artifacts"])
	}
	foundXML := false
	for _, raw := range arts {
		item := raw.(map[string]any)
		if item["kind"] == "xml" {
			foundXML = true
		}
		if item["type"] == nil || item["type"] == "" {
			t.Fatalf("missing type on %#v", item)
		}
	}
	if !foundXML {
		t.Fatal("expected an XML artifact in the fixture")
	}
	catalogGET(t, a, a.handleCatalogArtifacts, "/api/catalog/artifacts?id=nope", 404)
	catalogGET(t, a, a.handleCatalogArtifacts, "/api/catalog/artifacts?id=../etc", 404)
}

func TestHandleCatalogArtifactDownload(t *testing.T) {
	a := newCatalogApp(t)
	name := "dashboard-001-20261021.170103.600-create.result.xml"
	req := httptest.NewRequest(http.MethodGet, "/api/catalog/artifact?id="+fixtureDashboard+"&file="+name, nil)
	req.Host = "127.0.0.1:8000"
	rec := httptest.NewRecorder()
	a.handleCatalogArtifact(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "xml") {
		t.Fatalf("content-type %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, name) {
		t.Fatalf("content-disposition %q", cd)
	}
	if !strings.Contains(rec.Body.String(), "<result>") {
		t.Fatalf("body %q", rec.Body.String())
	}

	// Reject path traversal and non-allow-listed names.
	for _, file := range []string{"../spt_run_params.json", "spt_run_params.json", "engine.info.json", "", "a/b.csv"} {
		req := httptest.NewRequest(http.MethodGet, "/api/catalog/artifact?id="+fixtureDashboard+"&file="+file, nil)
		req.Host = "127.0.0.1:8000"
		rec := httptest.NewRecorder()
		a.handleCatalogArtifact(rec, req)
		if rec.Code != 404 {
			t.Fatalf("file %q: status %d, want 404", file, rec.Code)
		}
	}
}

func TestResolveCatalogArtifactPathRejectsSymlinkEscape(t *testing.T) {
	a := newCatalogApp(t)
	run, ok := a.findCatalogRun(fixtureDashboard)
	if !ok {
		t.Fatal("missing fixture")
	}
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(run.dir, "escape.messages.log")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, ok := resolveCatalogArtifactPath(run, "escape.messages.log"); ok {
		t.Fatal("symlink escape should be rejected")
	}
}

func TestHandleCatalogArtifactsEmpty(t *testing.T) {
	a := newCatalogApp(t)
	run, ok := a.findCatalogRun(fixturePartial)
	if !ok {
		t.Fatal("partial fixture missing")
	}
	// Partial fixture only has spt_run_params.json — no allow-listed artifacts.
	items, err := listCatalogArtifacts(run.dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("want empty, got %#v", items)
	}
	body := catalogGET(t, a, a.handleCatalogArtifacts, "/api/catalog/artifacts?id="+fixturePartial, 200)
	arts := body["artifacts"].([]any)
	if len(arts) != 0 {
		t.Fatalf("want empty list, got %#v", arts)
	}
}
