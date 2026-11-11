package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func prepareShutdownTest(t *testing.T) (*app, string, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture requires Unix")
	}
	a, marker := newRunHandlerTestApp(t)
	a.metricsURL = "http://127.0.0.1:1/metrics/json"
	a.storageFile = filepath.Join(a.stateDir, "storage-config.json")
	a.verifyFile = filepath.Join(a.stateDir, "storage-verification.json")
	args := filepath.Join(a.root, "arguments")
	ready := filepath.Join(a.root, "ready")
	t.Setenv("DASHBOARD_TEST_ARGS", args)
	t.Setenv("DASHBOARD_TEST_READY", ready)
	body := `#!/bin/sh
printf '%s\n' "$@" > "$DASHBOARD_TEST_ARGS"
trap 'printf stopped > "$DASHBOARD_TEST_MARKER"; exit 0' INT TERM
printf ready > "$DASHBOARD_TEST_READY"
while :; do /bin/sleep 0.05; done
`
	if err := os.WriteFile(a.sptBin, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.stopProcesses)
	return a, marker, args
}

func waitForChild(t *testing.T, root string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(filepath.Join(root, "ready")); err == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("child process did not start")
}

func TestDashboardShutdownInterruptsRun(t *testing.T) {
	a, marker, argsPath := prepareShutdownTest(t)
	request := httptest.NewRequest(http.MethodPost, "/api/runs", strings.NewReader(validRunRequest))
	request.Host = "localhost:8000"
	request.Header.Set("Origin", "http://localhost:8000")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	a.handleRun(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("start run: %d %s", response.Code, response.Body.String())
	}
	waitForChild(t, a.root)
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(args), "run\nwrite-verify\n--headless\n") {
		t.Fatalf("unexpected child arguments: %s", args)
	}
	a.stopProcesses()
	if data, err := os.ReadFile(marker); err != nil || string(data) != "stopped" {
		t.Fatalf("child was not gracefully interrupted: %q, %v", data, err)
	}
	a.mu.Lock()
	status := a.activeJob["status"]
	active := a.activeCmd != nil
	a.mu.Unlock()
	if active || status != jobInterrupted || a.lockBusy() { // the dashboard stopped SPT, so the run is interrupted even though the child exited 0
		t.Fatalf("child did not finish and release its lock: active=%v status=%v", active, status)
	}
}

// stopRequest sends POST /api/runs/{runID}/stop straight to handleStop.
func stopRequest(a *app, runID, origin string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/runs/"+runID+"/stop", nil)
	request.SetPathValue("runID", runID)
	request.Host = "localhost:8000"
	request.Header.Set("Origin", origin)
	response := httptest.NewRecorder()
	a.handleStop(response, request)
	return response
}

// startStoppableRun starts a run through handleRun and returns its run ID once
// the fake SPT child is ready.
func startStoppableRun(t *testing.T, a *app) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/runs", strings.NewReader(validRunRequest))
	request.Host = "localhost:8000"
	request.Header.Set("Origin", "http://localhost:8000")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	a.handleRun(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("start run: %d %s", response.Code, response.Body.String())
	}
	var body struct {
		Job struct {
			RunID string `json:"run_id"`
		} `json:"job"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Job.RunID == "" {
		t.Fatalf("start run response: %v %s", err, response.Body.String())
	}
	waitForChild(t, a.root)
	return body.Job.RunID
}

// currentJob returns the job that GET /api/state would publish.
func currentJob(t *testing.T, a *app) map[string]any {
	t.Helper()
	state, err := a.currentState()
	if err != nil {
		t.Fatal(err)
	}
	job, _ := state[keyJob].(map[string]any)
	if job == nil {
		t.Fatalf("state has no job: %v", state)
	}
	return job
}

func TestStopRunGracefully(t *testing.T) {
	a, marker, _ := prepareShutdownTest(t)
	const origin = "http://localhost:8000"
	if response := stopRequest(a, "mt-dashboard-none", "http://evil.example"); response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin stop: %d", response.Code)
	}
	if response := stopRequest(a, "mt-dashboard-none", origin); response.Code != http.StatusConflict {
		t.Fatalf("stop without a run: %d", response.Code)
	}
	runID := startStoppableRun(t, a)
	if job := currentJob(t, a); job[keyCanStop] != true {
		t.Fatalf("live run is not stoppable: %v", job)
	}
	response := stopRequest(a, runID, origin)
	if response.Code != http.StatusAccepted {
		t.Fatalf("stop run: %d %s", response.Code, response.Body.String())
	}
	var accepted struct {
		Job map[string]any `json:"job"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &accepted); err != nil || accepted.Job[keyStopRequested] != true {
		t.Fatalf("stop response job: %v %s", err, response.Body.String())
	}
	if at, _ := accepted.Job[keyStopRequestedAt].(string); at == "" {
		t.Fatalf("stop response has no stop_requested_at: %v", accepted.Job)
	} else if _, err := time.Parse(time.RFC3339Nano, at); err != nil {
		t.Fatalf("stop_requested_at is not RFC 3339: %q", at)
	}
	if response := stopRequest(a, runID, origin); response.Code != http.StatusAccepted && response.Code != http.StatusConflict {
		t.Fatalf("repeated stop: %d %s", response.Code, response.Body.String())
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		a.mu.Lock()
		status := a.activeJob[keyStatus]
		active := a.activeCmd != nil
		a.mu.Unlock()
		if !active && status == jobStopped && !a.lockBusy() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run did not finish as stopped: active=%v status=%v", active, status)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if data, err := os.ReadFile(marker); err != nil || string(data) != "stopped" {
		t.Fatalf("child was not gracefully interrupted: %q, %v", data, err)
	}
	if response := stopRequest(a, runID, origin); response.Code != http.StatusConflict {
		t.Fatalf("stop after the run ended: %d", response.Code)
	}
}

func TestStopChecksRunID(t *testing.T) {
	a, marker, _ := prepareShutdownTest(t)
	const origin = "http://localhost:8000"
	runID := startStoppableRun(t, a)
	for _, bad := range []string{"stop", "../" + runID, "mt-other-run", runID + "/x"} {
		if response := stopRequest(a, bad, origin); response.Code != http.StatusNotFound {
			t.Fatalf("malformed run ID %q: %d %s", bad, response.Code, response.Body.String())
		}
	}
	response := stopRequest(a, "mt-dashboard-20000101T000000-dead", origin)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "no longer active") {
		t.Fatalf("stop of another run: %d %s", response.Code, response.Body.String())
	}
	a.mu.Lock()
	requested := a.activeJob[keyStopRequested]
	a.mu.Unlock()
	if requested == true {
		t.Fatal("a stop for another run marked the active run as stopping")
	}
	if _, err := os.Stat(marker); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a stop for another run signalled SPT: %v", err)
	}
}

func TestStopRefusesAttachedRun(t *testing.T) {
	a, _ := newRunHandlerTestApp(t)
	a.mu.Lock()
	a.attachedHost = "127.0.0.1"
	a.attachedRunID = "42"
	a.mu.Unlock()
	response := stopRequest(a, "mt-dashboard-attached", "http://localhost:8000")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "only monitoring") {
		t.Fatalf("stop of an attached run: %d %s", response.Code, response.Body.String())
	}
}

func TestRestartedRunCannotBeStopped(t *testing.T) {
	a, _, _ := prepareShutdownTest(t)
	// A run started by an earlier dashboard process: its state file says
	// running and its SPT still holds the run lock, but this process has no
	// handle to it.
	if err := a.writeState(map[string]any{keyRunID: "mt-dashboard-20000101T000000-beef", keyStatus: jobRunning, keyStartedAt: utcNow()}); err != nil {
		t.Fatal(err)
	}
	lock, err := os.OpenFile(a.lockFile, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := lockFile(lock); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { unlockClose(lock) })
	job := currentJob(t, a)
	if job[keyStatus] != jobRunning || job[keyCanStop] != false {
		t.Fatalf("restarted run: status=%v can_stop=%v", job[keyStatus], job[keyCanStop])
	}
	if response := stopRequest(a, "mt-dashboard-20000101T000000-beef", "http://localhost:8000"); response.Code != http.StatusConflict {
		t.Fatalf("stop of a restarted run: %d %s", response.Code, response.Body.String())
	}
}
