package server

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestAttachReadsAnExistingRunAndCanDisconnect(t *testing.T) {
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = fmt.Fprint(w, `{"runId":"run-42","state":"running","message":"Existing CLI run","progress":37.5}`)
		case "/metrics/json":
			_, _ = fmt.Fprintf(w, `[{"sample_ts":%q,"test_state":1,"step_id":"create","op_type":"CREATE","scope":"node","role":"entry","elapsed_time_seconds":2,"operations":{"success_count":10,"failed_count":1,"success_rate_last":8},"bandwidth":{"bytes_total":10485760,"bytes_rate_last":8388608},"timing":{"latency":{"count":10,"p50_us":42}}}]`, stamp)
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(api.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	a := &app{port: "8000", sptAPIPort: port, storage: storageConfig{Hosts: []string{"127.0.0.1"}}, settings: defaultSettings()}
	handler := a.httpServer().Handler
	post := httptest.NewRequest(http.MethodPost, "/api/attach", strings.NewReader(`{"host":"127.0.0.1"}`))
	post.Host = "localhost:8000"
	post.Header.Set("Origin", "http://localhost:8000")
	post.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, post)
	if response.Code != http.StatusOK {
		t.Fatalf("attach status=%d body=%s", response.Code, response.Body.String())
	}
	var state map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	connection := state["connection"].(map[string]any)
	job := state["job"].(map[string]any)
	metrics := state["metrics"].(map[string]any)
	if connection["status"] != "connected" || connection["read_only"] != true || job["run_id"] != "run-42" {
		t.Fatalf("unexpected attached state: %#v", state)
	}
	if got := len(metrics["samples"].([]any)); got != 1 {
		t.Fatalf("attached live samples=%d; want 1", got)
	}

	get := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	get.Host = "localhost:8000"
	getResponse := httptest.NewRecorder()
	handler.ServeHTTP(getResponse, get)
	if getResponse.Code != http.StatusOK || !strings.Contains(getResponse.Body.String(), `"run_id":"run-42"`) {
		t.Fatalf("attached poll status=%d body=%s", getResponse.Code, getResponse.Body.String())
	}

	detach := httptest.NewRequest(http.MethodDelete, "/api/attach", nil)
	detach.Host = "localhost:8000"
	detach.Header.Set("Origin", "http://localhost:8000")
	detachResponse := httptest.NewRecorder()
	handler.ServeHTTP(detachResponse, detach)
	if detachResponse.Code != http.StatusOK || a.attachedHost != "" {
		t.Fatalf("detach status=%d, attached host=%q", detachResponse.Code, a.attachedHost)
	}
}

func TestAttachRejectsUnconfiguredHostsAndReportsUnreachableAPI(t *testing.T) {
	for _, test := range []struct {
		name       string
		configured string
		requested  string
		apiPort    string
		wantStatus int
		wantText   string
	}{
		{name: "unconfigured host", configured: "127.0.0.1", requested: "example.com", apiPort: "1", wantStatus: http.StatusBadRequest, wantText: "already listed"},
		{name: "unreachable API", configured: "127.0.0.1", requested: "127.0.0.1", apiPort: "1", wantStatus: http.StatusBadGateway, wantText: "Could not reach SPT"},
	} {
		t.Run(test.name, func(t *testing.T) {
			a := &app{port: "8000", sptAPIPort: test.apiPort, storage: storageConfig{Hosts: []string{test.configured}}, settings: defaultSettings()}
			request := httptest.NewRequest(http.MethodPost, "/api/attach", strings.NewReader(fmt.Sprintf(`{"host":%q}`, test.requested)))
			request.Host = "localhost:8000"
			request.Header.Set("Origin", "http://localhost:8000")
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			a.httpServer().Handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantText) {
				t.Fatalf("status=%d body=%s; wanted status %d containing %q", response.Code, response.Body.String(), test.wantStatus, test.wantText)
			}
		})
	}
}

func TestAttachRequiresSameOrigin(t *testing.T) {
	a := &app{port: "8000", storage: storageConfig{Hosts: []string{"127.0.0.1"}}}
	request := httptest.NewRequest(http.MethodPost, "/api/attach", strings.NewReader(`{"host":"127.0.0.1"}`))
	request.Host = "localhost:8000"
	request.Header.Set("Origin", "https://attacker.example")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	a.httpServer().Handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s; want forbidden", response.Code, response.Body.String())
	}
}

func TestFetchAttachedStatusUsesConfiguredSPTStatusContract(t *testing.T) {
	want := attachedStatus{RunID: "run-9", State: "running", Message: "Run active", Progress: 12.5}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/status" || r.Method != http.MethodGet {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(want)
	}))
	defer server.Close()
	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	got, err := fetchAttachedStatus(u.String())
	if err != nil || got != want {
		t.Fatalf("status=%+v error=%v; want %+v", got, err, want)
	}
}
