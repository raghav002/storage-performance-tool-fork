package server

import (
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const fixtureDashboardRunID = "mt-dashboard-20261021T170103-518aaa08"

// The existing saved-run endpoints read the same spt_run_params.json files as the catalog.
// These checks pin that they keep exposing settings only, never the stored S3 credentials.
func TestSavedRunEndpointsNeverExposeCredentials(t *testing.T) {
	a := newCatalogApp(t)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/runs", a.handleRunHistory)
	mux.HandleFunc("GET /api/runs/{runID}", a.handleSavedRun)
	mux.HandleFunc("GET /api/runs/{runID}/csv", a.handleRunCSV)
	get := func(target string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req.Host = "127.0.0.1:8000"
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if strings.Contains(rec.Body.String(), "CANARY") {
			t.Fatalf("%s exposed a credential value", target)
		}
		return rec
	}
	if rec := get("/api/runs"); rec.Code != 200 || !strings.Contains(rec.Body.String(), fixtureDashboardRunID) {
		t.Errorf("history: %d %s", rec.Code, rec.Body.String())
	}
	if rec := get("/api/runs/" + fixtureDashboardRunID); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"object_count"`) {
		t.Errorf("saved run: %d %s", rec.Code, rec.Body.String())
	}
	for _, kind := range []string{"summary", "samples"} {
		if rec := get("/api/runs/" + fixtureDashboardRunID + "/csv?kind=" + kind); rec.Code != 200 {
			t.Errorf("csv %s: %d %s", kind, rec.Code, rec.Body.String())
		}
	}
	if rec := get("/api/runs/cli-baseline/csv"); rec.Code != 404 {
		t.Errorf("non-dashboard id should be 404, got %d", rec.Code)
	}
	if rec := get("/api/runs/" + fixtureDashboardRunID + "/csv?bogus=1"); rec.Code != 400 {
		t.Errorf("unsupported csv option should be 400, got %d", rec.Code)
	}
}

func TestWindowCSVMatchesChartTimeOrigin(t *testing.T) {
	for _, tc := range []struct {
		name, startedAt, window string
		want                    int
	}{
		{"fractional start", "2026-10-20T10:00:00.0005Z", "start=0&end=2", 2},
		{"missing start uses first phase sample", "", "start=0&end=2", 2},
		{"sample before start is shown at zero", "2026-10-20T10:00:00.001Z", "start=0&end=0", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := newCatalogApp(t)
			if err := a.writeRunRecord(map[string]any{
				keyRunID: fixtureDashboardRunID, keyStatus: jobCompleted, keyStartedAt: tc.startedAt,
			}); err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodGet, "/api/runs/"+fixtureDashboardRunID+"/csv?kind=window&phase=CREATE&"+tc.window, nil)
			req.Host = "127.0.0.1:8000"
			req.SetPathValue("runID", fixtureDashboardRunID)
			rec := httptest.NewRecorder()
			a.handleRunCSV(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("window CSV status %d: %s", rec.Code, rec.Body.String())
			}
			rows, err := csv.NewReader(rec.Body).ReadAll()
			if err != nil {
				t.Fatal(err)
			}
			if got := len(rows) - 1; got != tc.want {
				t.Fatalf("exported %d samples, want %d shown in the chart", got, tc.want)
			}
		})
	}
}
