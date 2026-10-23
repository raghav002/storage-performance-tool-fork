package server

import (
	"os"
	"path/filepath"
	"testing"
)

// A run with no dashboard record is completed once SPT has written its results
// summary, which lands in the label folder, or once all three write-verify
// phases are on disk. A started run without either stays partial.
func TestSavedRunStatusReadsSPTSummaryFile(t *testing.T) {
	root := t.TempDir()
	a := newHistoryApp(t, root)
	const withSummary = "mt-dashboard-20261023T214759-de8f1520"
	const onePhase = "mt-dashboard-20261023T215300-0a0b0c0d"
	const notStarted = "mt-dashboard-20261023T215226-520e6984"
	writeSavedRun(t, a.results, withSummary, "write-verify", 25, 25, true)
	writeSavedRun(t, a.results, onePhase, "write-verify", 25, 25, false)
	writeSavedRun(t, a.results, notStarted, "write-verify", 25, -1, false)
	got := historyStatuses(t, a)
	want := map[string]string{withSummary: jobCompleted, onePhase: jobPartial, notStarted: jobPartial}
	for id, status := range want {
		if got[id] != status {
			t.Errorf("%s: status %q, want %q (all: %v)", id, got[id], status, got)
		}
	}
	if job := savedRunStatusOf(t, a, withSummary); str(job["status"]) != jobCompleted {
		t.Errorf("saved-run detail status = %v, want completed", job["status"])
	}
}

// Runs from builds that kept no run record are classified from SPT's own trace
// log: the Dev VM run stopped during setup (Oct 23, 22:00 UTC) and the box run
// whose container image was missing (Oct 23, 21:06 UTC).
func TestLegacyRunHistoryReadsTraceLog(t *testing.T) {
	root := t.TempDir()
	a := newHistoryApp(t, root)
	const stopped = "mt-dashboard-20261023T220053-47a8ef59"
	const startFailed = "mt-dashboard-20261023T210640-c3fb31ba"
	const stoppedAfterSummary = "mt-dashboard-20261023T222235-0c13dc5a"
	writeSavedRun(t, a.results, stopped, "write-verify", 320, -1, false)
	writeSavedRun(t, a.results, startFailed, "write-verify", 25, -1, false)
	writeSavedRun(t, a.results, stoppedAfterSummary, "write-verify", 320, 320, true)
	writeTraceLog(t, a.results, stopped, "[2026-10-23 22:00:53] [INIT] Starting Spt in API mode...\n"+
		"[2026-10-23 22:00:55] [SIGNAL] Received signal interrupt, shutting down gracefully...\n"+
		"[2026-10-23 22:01:06] [ERROR] Failed to start test: failed to start container in node mode: interrupt signal\n")
	writeTraceLog(t, a.results, startFailed, "[2026-10-23 16:06:40] [INIT] Starting Spt in API mode...\n"+
		"[2026-10-23 16:06:40] [ERROR] Failed to start test: failed to start container in node mode: dev image not present locally\n")
	writeTraceLog(t, a.results, stoppedAfterSummary, "[2026-10-23 22:22:40] [SIGNAL] Received signal interrupt, shutting down gracefully...\n")
	got := historyStatuses(t, a)
	want := map[string]string{stopped: jobInterrupted, startFailed: jobFailed, stoppedAfterSummary: jobCompleted}
	for id, status := range want {
		if got[id] != status {
			t.Errorf("%s: status %q, want %q (all: %v)", id, got[id], status, got)
		}
	}
}

func writeTraceLog(t *testing.T, results, runID, body string) {
	t.Helper()
	p := filepath.Join(results, runID, "dashboard-20261023.214759.259", "spt-20261023.214759.259.trace.log")
	if err := os.WriteFile(p, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}
