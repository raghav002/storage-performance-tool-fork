package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validRunRequest = `{"object_count":10,"object_size":"64KiB","threads":1,"max_runtime_seconds":60}`

// Only local fixtures are used: the handler must reject every request below
// before invoking SPT or creating a run. The stub records unexpected execution.
func newRunHandlerTestApp(t *testing.T) (*app, string) {
	t.Helper()
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(root, "spt-invoked")
	t.Setenv("DASHBOARD_TEST_MARKER", marker)
	t.Setenv("PATH", bin)
	t.Setenv("S3_ENDPOINTS", "https://storage.example.invalid")
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("S3_BUCKET", "dashboard-test")
	t.Setenv("S3_ACCESS_KEY", "test-access-key")
	t.Setenv("S3_SECRET_KEY", "test-secret-key")
	for _, name := range []string{"spt", "docker"} {
		body := "#!/bin/sh\nprintf 'unexpected execution\\n' >> \"$DASHBOARD_TEST_MARKER\"\nexit 97\n"
		if err := os.WriteFile(filepath.Join(bin, name), []byte(body), 0700); err != nil {
			t.Fatal(err)
		}
	}
	a := &app{
		root: root, home: root, port: "8000", sptBin: filepath.Join(bin, "spt"),
		results: filepath.Join(root, "results"), stateDir: root,
		stateFile: filepath.Join(root, "latest-job.json"), lockFile: filepath.Join(root, "job.lock"),
		storage: storageConfig{Hosts: []string{"127.0.0.1"}},
	}
	a.verification = verification{
		Status:    "passed",
		Signature: configSignature(a.storage.Hosts, "https://storage.example.invalid"),
	}
	if target := a.targetConfiguration(); target["ready"] != true {
		t.Fatalf("test setup is not ready: %#v", target["reasons"])
	}
	return a, marker
}

func assertRejectedRun(t *testing.T, a *app, marker string, response *httptest.ResponseRecorder, wantStatus int) {
	t.Helper()
	if response.Code != wantStatus {
		t.Fatalf("status = %d, want %d; body: %s", response.Code, wantStatus, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Errorf("response Content-Type = %q, want JSON", got)
	}
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON error response: %v", err)
	}
	if body.Error == "" {
		t.Error("rejected request has no error message")
	}
	if a.activeJob != nil || a.activeCmd != nil || a.activeLock != nil {
		t.Error("rejected request created an active run")
	}
	for _, path := range []string{marker, a.stateFile} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("rejected request unexpectedly created %s (stat error: %v)", filepath.Base(path), err)
		}
	}
	entries, err := os.ReadDir(a.results)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("rejected request created %d result entries", len(entries))
	}
}

func TestHandleRunRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name, target, host, origin, contentType, body string
		wantStatus                                    int
	}{
		{"unexpected path", "/api/runs/extra", "localhost:8000", "http://localhost:8000", "application/json", validRunRequest, http.StatusNotFound},
		{"query string", "/api/runs?extra=1", "localhost:8000", "http://localhost:8000", "application/json", validRunRequest, http.StatusNotFound},
		{"missing origin", "/api/runs", "localhost:8000", "", "application/json", validRunRequest, http.StatusForbidden},
		{"cross port origin", "/api/runs", "localhost:8000", "http://localhost:5173", "application/json", validRunRequest, http.StatusForbidden},
		{"untrusted host", "/api/runs", "other.example", "http://other.example", "application/json", validRunRequest, http.StatusForbidden},
		{"wrong content type", "/api/runs", "localhost:8000", "http://localhost:8000", "text/plain", validRunRequest, http.StatusUnsupportedMediaType},
		{"missing content type", "/api/runs", "localhost:8000", "http://localhost:8000", "", validRunRequest, http.StatusUnsupportedMediaType},
		{"empty body", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", "", http.StatusBadRequest},
		{"malformed JSON", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", "{", http.StatusBadRequest},
		{"wrong field type", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", `{"object_count":"10"}`, http.StatusBadRequest},
		{"unknown field", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", strings.TrimSuffix(validRunRequest, "}") + `,"command":"ignored"}`, http.StatusBadRequest},
		{"second JSON object", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", validRunRequest + " {}", http.StatusBadRequest},
		{"trailing garbage", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", validRunRequest + " invalid", http.StatusBadRequest},
		{"oversized body", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", strings.Repeat(" ", maxRequestBytes+1) + validRunRequest, http.StatusBadRequest},
		{"missing options", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", "{}", http.StatusBadRequest},
		{"unsupported count", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", strings.Replace(validRunRequest, `"object_count":10`, `"object_count":321`, 1), http.StatusBadRequest},
		{"unsupported size", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", strings.Replace(validRunRequest, "64KiB", "100MiB", 1), http.StatusBadRequest},
		{"unsupported threads", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", strings.Replace(validRunRequest, `"threads":1`, `"threads":3`, 1), http.StatusBadRequest},
		{"unsupported runtime", "/api/runs", "localhost:8000", "http://localhost:8000", "application/json", strings.Replace(validRunRequest, `"max_runtime_seconds":60`, `"max_runtime_seconds":601`, 1), http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a, marker := newRunHandlerTestApp(t)
			request := httptest.NewRequest(http.MethodPost, tt.target, strings.NewReader(tt.body))
			request.Host = tt.host
			request.Header.Set("Origin", tt.origin)
			request.Header.Set("Content-Type", tt.contentType)
			response := httptest.NewRecorder()
			a.handleRun(response, request)
			assertRejectedRun(t, a, marker, response, tt.wantStatus)
		})
	}
}
