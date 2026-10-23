package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const mockTotalsHeader = "DateTimeISO8601,OpType,Concurrency,NodeCount,ConcurrencyCurr,ConcurrencyMean,CountSucc,CountFail,CountCorrupt,Size,StepDuration[s],DurationSum[s],TPAvg[op/s],TPLast[op/s],BWAvg[MiB/s],BWLast[MiB/s],DurationAvg[us],DurationMin[us],DurationQ_0.25[us],DurationQ_0.5[us],DurationQ_0.75[us],DurationQ_0.9[us],DurationQ_0.99[us],DurationQ_0.999[us],DurationMax[us],LatencyAvg[us],LatencyMin[us],LatencyQ_0.25[us],LatencyQ_0.5[us],LatencyQ_0.75[us],LatencyQ_0.9[us],LatencyQ_0.99[us],LatencyQ_0.999[us],LatencyMax[us],TtfbAvg[us],TtfbMin[us],TtfbQ_0.25[us],TtfbQ_0.5[us],TtfbQ_0.75[us],TtfbQ_0.9[us],TtfbQ_0.99[us],TtfbQ_0.999[us],TtfbMax[us]\n"

// writeSavedRun lays out a dashboard run the way SPT writes it:
// results/<runID>/<label-stamp>/ with spt_run_params.json and the metrics files.
func writeSavedRun(t *testing.T, results, runID, workload string, objects, created int, summaryFile bool) {
	t.Helper()
	dir := filepath.Join(results, runID, "dashboard-20261023.214759.259")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	params := map[string]any{
		"generatedAt": "2026-10-23T21:47:59Z", "workloadType": workload, "label": "dashboard",
		"scenarioParams": map[string]any{"WorkloadType": workload, "ObjectCount": objects, "ObjectSize": "1MiB", "Threads": 1, "AccessKey": "", "SecretKey": ""},
	}
	b, _ := json.Marshal(params)
	if err := os.WriteFile(filepath.Join(dir, "spt_run_params.json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	if created >= 0 {
		row := `"2026-10-23T21:48:01,252",CREATE,1,1,0,0.0,` + strconv.Itoa(created) + `,0,0,26214400,0.018,8.3E-5,1315.78,0.0,1315.78,0.0,4.88,1,1,1,1,4,64,64,64,1.0,1,1,1,1,1,1,1,1,,,,,,,,,` + "\n"
		if err := os.WriteFile(filepath.Join(dir, "dashboard-001-20261023.214759.257-create.metrics.total.csv"), []byte(mockTotalsHeader+row), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if summaryFile {
		if err := os.WriteFile(filepath.Join(dir, "spt_dashboard-20261023.214759.259_results_summary.txt"), []byte("summary\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func newHistoryApp(t *testing.T, root string) *app {
	t.Helper()
	return &app{
		root: root, home: root, port: "8000", results: filepath.Join(root, "results"), stateDir: filepath.Join(root, "state"),
		stateFile: filepath.Join(root, "state", "latest-job.json"), lockFile: filepath.Join(root, "state", "job.lock"),
	}
}

func historyStatuses(t *testing.T, a *app) map[string]string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/runs", nil)
	req.Host = "127.0.0.1:8000"
	rec := httptest.NewRecorder()
	a.handleRunHistory(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("history: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Runs []map[string]any `json:"runs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, run := range body.Runs {
		out[str(run["run_id"])] = str(run["status"])
	}
	return out
}

func savedRunStatusOf(t *testing.T, a *app, runID string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/runs/"+runID, nil)
	req.Host = "127.0.0.1:8000"
	req.SetPathValue("runID", runID)
	rec := httptest.NewRecorder()
	a.handleSavedRun(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("saved run %s: %d %s", runID, rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	job, _ := body["job"].(map[string]any)
	return job
}

// Root cause of the Dev VM flip: the history handlers only read the state file
// once /api/state had loaded it, and a dashboard shutdown recorded SPT's exit 1
// as "failed". The run must read as interrupted from the first request on.
func TestShutdownRecordsInterruptedRunThatStaysInterrupted(t *testing.T) {
	a, _, _ := prepareShutdownTest(t)
	body := `#!/bin/sh
trap 'exit 1' INT TERM
printf ready > "$DASHBOARD_TEST_READY"
while :; do /bin/sleep 0.05; done
`
	if err := os.WriteFile(a.sptBin, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
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
	a.mu.Lock()
	runID := str(a.activeJob["run_id"])
	a.mu.Unlock()
	a.stopProcesses()

	a.mu.Lock()
	job := cloneMap(a.activeJob)
	a.mu.Unlock()
	if job["status"] != jobInterrupted || job["returncode"] != 1 || job["message"] != msgInterruptedShutdown {
		t.Fatalf("after shutdown: %v", job)
	}
	if state := a.readStateFile(); state["status"] != jobInterrupted {
		t.Fatalf("state file: %v", state)
	}
	if record := a.readRunRecord(runID); record == nil || record["status"] != jobInterrupted {
		t.Fatalf("run record: %v", record)
	}

	// SPT wrote its params before the stop; the run shows up in history.
	writeSavedRun(t, a.results, runID, "write-verify", 10, 3, false)
	restarted := &app{root: a.root, home: a.root, port: a.port, results: a.results, stateDir: a.stateDir, stateFile: a.stateFile, lockFile: a.lockFile}
	if got := historyStatuses(t, restarted)[runID]; got != jobInterrupted {
		t.Fatalf("history after restart, before /api/state: %q", got)
	}

	// A later job replaces latest-job.json; the interrupted run keeps its status.
	later := map[string]any{"run_id": "mt-dashboard-20261023T230000-11223344", "status": jobCompleted, "returncode": 0}
	if err := a.writeState(later); err != nil {
		t.Fatal(err)
	}
	afterLater := &app{root: a.root, home: a.root, port: a.port, results: a.results, stateDir: a.stateDir, stateFile: a.stateFile, lockFile: a.lockFile}
	for i := 0; i < 3; i++ {
		if got := historyStatuses(t, afterLater)[runID]; got != jobInterrupted {
			t.Fatalf("history after a later job (pass %d): %q", i, got)
		}
	}
	if detail := savedRunStatusOf(t, afterLater, runID); detail["status"] != jobInterrupted || detail["message"] != msgInterruptedShutdown {
		t.Fatalf("saved-run detail after a later job: %v", detail)
	}
}

// A state file left at "running" (the dashboard was killed before SPT reported)
// settles to interrupted on the first request after a restart, whether that is
// Run history or /api/state, and does not change afterwards.
func TestRestartSettlesStaleRunningRunAsInterrupted(t *testing.T) {
	for _, first := range []string{"history", "state"} {
		t.Run(first, func(t *testing.T) {
			a, _ := newRunHandlerTestApp(t)
			runID := "mt-dashboard-20261023T220053-47a8ef59"
			writeSavedRun(t, a.results, runID, "write-verify", 25, 3, false)
			if err := a.writeState(map[string]any{"run_id": runID, "status": jobRunning, "returncode": nil}); err != nil {
				t.Fatal(err)
			}
			if first == "state" {
				state, err := a.currentState()
				if err != nil {
					t.Fatal(err)
				}
				if job, _ := state["job"].(map[string]any); str(job["status"]) != jobInterrupted {
					t.Fatalf("/api/state job: %v", state["job"])
				}
			}
			for i := 0; i < 3; i++ {
				if got := historyStatuses(t, a)[runID]; got != jobInterrupted {
					t.Fatalf("history pass %d: %q", i, got)
				}
			}
			if record := a.readRunRecord(runID); record == nil || record["status"] != jobInterrupted || record["message"] != msgInterruptedRestart {
				t.Fatalf("run record: %v", record)
			}
			if state := a.readStateFile(); state["status"] != jobInterrupted {
				t.Fatalf("state file: %v", state)
			}
		})
	}
}

func TestFinalStatus(t *testing.T) {
	exitErr := &os.PathError{Op: "wait", Err: os.ErrClosed}
	cases := []struct {
		err      error
		stopping bool
		want     string
	}{
		{nil, false, jobCompleted},
		{nil, true, jobCompleted},
		{exitErr, false, jobFailed},
		{exitErr, true, jobInterrupted},
	}
	for _, c := range cases {
		if got, _ := finalStatus(c.err, c.stopping); got != c.want {
			t.Errorf("finalStatus(%v, %v) = %q, want %q", c.err, c.stopping, got, c.want)
		}
	}
}
