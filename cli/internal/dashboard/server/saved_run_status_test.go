package server

import "testing"

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
