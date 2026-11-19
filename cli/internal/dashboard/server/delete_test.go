package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/dell/storage-performance-tool/cli/internal/deletemetrics"
)

func deleteTestOptions() options {
	zero := int64(0)
	no := false
	return options{Mode: modeGuided, Workload: "delete", ObjectCount: 25, ObjectSize: "1KiB", Threads: 1,
		Delete: &deleteOptions{BatchSize: 10, Verify: &no, VerificationTimeout: 30, MaxFailedObjects: &zero}}
}

func TestDeleteRequestRejectsUnsupportedAndConflictingSettings(t *testing.T) {
	for name, change := range map[string]func(*options){
		"expert":                  func(o *options) { o.Mode = modeExpert },
		"mock":                    func(o *options) { o.Driver = driverMock },
		"unknown workload":        func(o *options) { o.Workload = "read" },
		"missing settings":        func(o *options) { o.Delete = nil },
		"wrong workload":          func(o *options) { o.Workload = driverWriteVerify },
		"runtime":                 func(o *options) { o.MaxRuntimeSeconds = 60 },
		"batch below range":       func(o *options) { o.Delete.BatchSize = 0 },
		"batch above range":       func(o *options) { o.Delete.BatchSize = 1001 },
		"unlisted batch":          func(o *options) { o.Delete.BatchSize = 7 },
		"unlisted size":           func(o *options) { o.ObjectSize = "1MiB" },
		"count zero":              func(o *options) { o.ObjectCount = 0 },
		"both budgets":            func(o *options) { n := 5.0; o.Delete.MaxFailurePercent = &n },
		"no budget":               func(o *options) { o.Delete.MaxFailedObjects = nil },
		"negative budget":         func(o *options) { n := int64(-1); o.Delete.MaxFailedObjects = &n },
		"grace with fixed budget": func(o *options) { n := 30; o.Delete.FailureBudgetGrace = &n },
		"timeout zero":            func(o *options) { o.Delete.VerificationTimeout = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			a, marker := newRunHandlerTestApp(t)
			o := deleteTestOptions()
			change(&o)
			w := launchContractRequest(t, a, o)
			assertRejectedRun(t, a, marker, w, http.StatusBadRequest)
		})
	}
	for _, unknown := range []string{`"delete_existing":true`, `"items_file":"/tmp/items.csv"`, `"prefix":"other/"`, `"duration":"1m"`} {
		t.Run(unknown, func(t *testing.T) {
			a, marker := newRunHandlerTestApp(t)
			body, _ := json.Marshal(deleteTestOptions())
			body = append(body[:len(body)-1], []byte(","+unknown+"}")...)
			r := httptest.NewRequest(http.MethodPost, "/api/runs", strings.NewReader(string(body)))
			r.Host = "localhost:8000"
			r.Header.Set("Origin", "http://localhost:8000")
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			a.handleRun(w, r)
			assertRejectedRun(t, a, marker, w, http.StatusBadRequest)
		})
	}
}

func TestDeleteLaunchAndPersistedSettings(t *testing.T) {
	for _, post := range []string{"default", "false", "true"} {
		t.Run(post, func(t *testing.T) {
			a, marker, argsPath, _ := newLaunchContractApp(t)
			a.storage.Endpoint = "https://storage.example.invalid"
			a.verification = verification{Status: verifyPassed, Signature: configSignature(a.storageSnapshot().Hosts, "https://storage.example.invalid")}
			o := deleteTestOptions()
			o.Delete.ValidateInventory = true
			o.Delete.Verify = nil
			o.Delete.Cleanup = true
			if post != "default" {
				b := post == "true"
				o.Delete.Verify = &b
			}
			pct, grace := 5.0, 30
			o.Delete.MaxFailedObjects, o.Delete.MaxFailurePercent, o.Delete.FailureBudgetGrace = nil, &pct, &grace
			t.Setenv("SPT_RDMA", "true")
			t.Setenv("SPT_PART_SIZE", "5MiB")
			w := launchContractRequest(t, a, o)
			if w.Code != http.StatusAccepted {
				t.Fatalf("launch = %d %s", w.Code, w.Body.String())
			}
			waitForRecoveryRun(t, a)
			args := readLaunchFields(t, argsPath)
			if !reflect.DeepEqual(args[:2], []string{"run", "delete"}) {
				t.Fatalf("wrong workload: %v", args)
			}
			for _, forbidden := range []string{"--auto-terminate-seconds", "--duration", "--items-file", "--delete-existing", "--max-failed-objects"} {
				if slices.Contains(args, forbidden) {
					t.Fatalf("unexpected %s in %v", forbidden, args)
				}
			}
			for _, required := range []string{"--validate-inventory=true", "--cleanup=true", "--max-failure-percent", "--failure-budget-grace", "--delete-batch-size"} {
				if !slices.Contains(args, required) {
					t.Fatalf("missing %s in %v", required, args)
				}
			}
			if post == "default" {
				for _, arg := range args {
					if strings.HasPrefix(arg, "--verify=") {
						t.Fatal("omitted verification became explicit")
					}
				}
			} else if !slices.Contains(args, "--verify="+post) {
				t.Fatal("explicit verification choice lost")
			}
			job := a.readStateFile()
			runID := str(job[keyRunID])
			if args[slices.Index(args, "--prefix")+1] != "dashboard/"+runID+"/" {
				t.Fatal("prefix is not run-owned")
			}
			if jobWorkload(job) != "delete" {
				t.Fatal("saved workload lost")
			}
			record := a.readRunRecord(runID)
			if !reflect.DeepEqual(record[keyOptions], job[keyOptions]) {
				t.Fatal("per-run outcome lost Delete settings")
			}
			values := map[string]string{}
			for _, value := range a.childEnvironment(o, a.targetConfiguration()) {
				k, v, _ := strings.Cut(value, "=")
				values[k] = v
			}
			if values["SPT_RDMA"] != "false" || values["SPT_PART_SIZE"] != "" || values["S3_BUCKETS"] != "" {
				t.Fatal("operator environment changed the Delete transport or dataset")
			}
			for flag, want := range map[string]string{"--object-count": "25", "--object-size": "1KiB", "--delete-batch-size": "10", "--verification-timeout": "30s"} {
				i := slices.Index(args, flag)
				if i < 0 || i+1 >= len(args) || args[i+1] != want {
					t.Fatalf("%s did not preserve the selected value in %v", flag, args)
				}
			}
			assertNotInvoked(t, marker)
		})
	}
}

func newDeleteResultsApp(t *testing.T) (*app, string) {
	t.Helper()
	a := newHistoryApp(t, t.TempDir())
	dir := filepath.Join(a.results, csvExportRunID, "dashboard-20261022.120000.000")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"spt_run_params.json":     `{"workloadType":"delete","scenarioParams":{"ObjectCount":25,"ObjectSize":"1KiB","Threads":1,"DeleteBatchSize":10,"SelectionOrder":"canonical"}}`,
		"001-seed.metrics.csv":    "2026-10-22T12:00:02Z,CREATE,25,0,2,12.5,12.5,1,1,2,25600,1,1\n",
		"002-delete.metrics.csv":  "2026-10-22T12:00:04Z,DELETE,3,0,2,1.5,1.5,,,2,0,1,1\n",
		"003-cleanup.metrics.csv": "2026-10-22T12:00:06Z,DELETE,1,1,2,0.5,0.5,0,0,2,0,1,1\n",
	}
	for name, body := range files {
		if strings.HasSuffix(name, ".csv") {
			data := parsingCSVHeader + body
			if err := os.WriteFile(filepath.Join(dir, strings.TrimSuffix(name, ".csv")+".total.csv"), []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			body = data
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return a, dir
}

func TestDeleteResultsSeparateSeedMeasurementAndCleanup(t *testing.T) {
	a, dir := newDeleteResultsApp(t)
	m := a.readRealRun(filepath.Dir(dir), csvExportRunID, false)
	if m == nil {
		t.Fatal("Delete metrics not loaded")
	}
	if m[keySourceFile] != "002-delete.metrics.total.csv" {
		t.Fatalf("picked seed or cleanup as primary: %v", m[keySourceFile])
	}
	rows := metricsSummaries(m)
	if len(rows) != 3 {
		t.Fatalf("phases = %v", rows)
	}
	for i, want := range []string{"SEED", "DELETE", "CLEANUP"} {
		if rows[i][keyPhase] != want {
			t.Errorf("phase %d = %v; want %s", i, rows[i][keyPhase], want)
		}
		if i > 0 && (rows[i][metricBandwidth] != nil || rows[i]["bytes_processed"] != nil) {
			t.Fatal("DELETE fabricated transfer metrics")
		}
	}
	if m["delete_detail_error"] == nil {
		t.Fatal("missing terminal object evidence was hidden")
	}
	for phase, count := range map[string]int{"SEED": 25, "DELETE": 3, "CLEANUP": 1} {
		rec := requestCSVExport(a, csvExportRunID, "?kind=phase&phase="+phase)
		rows := decodeCSVExport(t, rec, "spt-"+csvExportRunID+"-"+strings.ToLower(phase)+"-phase.csv")
		if len(rows) != 1 || rows[0]["cumulative_ops"] != strconv.Itoa(count) {
			t.Fatalf("%s export mixed phases: %v", phase, rows)
		}
	}
	if got := savedRunStatus(filepath.Dir(dir), dir, map[string]any{"workloadType": "delete"}, metricsSummaries(m)); got != jobPartial {
		t.Fatalf("missing completion evidence = %s", got)
	}
}

func TestDeleteComparisonsAndArtifacts(t *testing.T) {
	base := catalogRun{Workload: "delete", DeleteIdentity: "seeded; batch=10; order=canonical"}
	other := base
	other.DeleteIdentity = "seeded; batch=100; order=canonical"
	if len(settingsDifferences(base, other)) == 0 {
		t.Fatal("different batching compared as equivalent")
	}
	other.DeleteIdentity = ""
	if len(settingsDifferences(base, other)) == 0 {
		t.Fatal("missing batching treated as equivalent")
	}
	for _, name := range []string{"002-delete.delete.requests.csv", "002-delete.delete.objects.csv", "002-delete.delete.verification.csv", "002-delete.items.csv", "verify-input.csv", "002-delete.delete.complete.json"} {
		if _, _, ok := classifyArtifact(name); !ok {
			t.Errorf("missing Delete artifact %s", name)
		}
	}
	for _, name := range []string{"spt_run_params.json", "credentials.env"} {
		if _, _, ok := classifyArtifact(name); ok {
			t.Errorf("unexpected artifact %s", name)
		}
	}
}

func TestSavedDeleteDetailRejectsIncompleteTerminalEvidence(t *testing.T) {
	detail := &deletemetrics.Metrics{}
	body, err := json.Marshal(map[string]any{"deleteMetrics": map[string]any{"002-delete": detail}})
	if err != nil {
		t.Fatal(err)
	}
	if deletemetrics.ValidateTerminal(savedDeleteDetails(body)["002-delete"]) == nil {
		t.Fatal("incomplete detail accepted")
	}
}

func TestDeleteSavedObjectOutcomesAndRequestCounts(t *testing.T) {
	a, dir := newDeleteResultsApp(t)
	scheduled, drain, total := 2.0, 0.25, 2.25
	timing := &deletemetrics.TimingStat{Count: 3, MeanUs: 1, MinUs: 1, P50Us: 1, P90Us: 1, P99Us: 1, P999Us: 1, MaxUs: 1}
	detail := &deletemetrics.Metrics{
		Units:              deletemetrics.Units{Requests: deletemetrics.RequestUnit, Objects: deletemetrics.ObjectUnit, Batches: deletemetrics.RequestUnit},
		Requests:           deletemetrics.Requests{Attempted: 3, FullSuccess: 3, PerSecond: 1.5},
		Objects:            deletemetrics.Objects{Selected: 25, Attempted: 25, Accepted: 25, PerSecond: 12.5},
		Batches:            deletemetrics.Batches{ConfiguredSize: 10, ActualRequestCount: 3, ActualObjectCount: 25, MeanObjectsPerRequest: 25.0 / 3, FullBatchCount: 2, PartialBatchCount: 1, FullBatchPercent: 200.0 / 3},
		Completion:         deletemetrics.Completion{RequestPercent: 100, ObjectPercent: 100, TerminalReconciled: true},
		Versions:           deletemetrics.Versions{CurrentKey: 25},
		Buckets:            []deletemetrics.Bucket{{Bucket: "bench", Selected: 25, Attempted: 25, Accepted: 25}},
		Phases:             deletemetrics.Phases{ScheduledDeleteSeconds: &scheduled, DrainSeconds: &drain, TotalWallSeconds: &total},
		Identity:           deletemetrics.Identity{Mode: "batch", ConfiguredBatchSize: 10, SelectionOrder: "canonical"},
		FailurePolicy:      deletemetrics.FailurePolicy{Mode: "fixed", Outcome: deletemetrics.OutcomeCompletedCleanly},
		Timing:             deletemetrics.Timing{LatencyDefinition: deletemetrics.LatencyDefinition, DurationDefinition: deletemetrics.DurationDefinition, Latency: timing, Duration: timing},
		Performance:        deletemetrics.Performance{ObjectSize: deletemetrics.NotApplicable, DataMoved: deletemetrics.NotApplicable, Bandwidth: deletemetrics.NotApplicable, TTFB: deletemetrics.NotApplicable},
		OutcomeTerminology: deletemetrics.OutcomeAccepted,
		Verification:       deletemetrics.Verification{Notice: deletemetrics.VerificationNotice},
		TerminalReconciled: true,
	}
	if err := deletemetrics.ValidateTerminal(detail); err != nil {
		t.Fatalf("bad fixture: %v", err)
	}
	paramsPath := filepath.Join(dir, "spt_run_params.json")
	data, err := os.ReadFile(paramsPath)
	if err != nil {
		t.Fatal(err)
	}
	var params map[string]any
	if err := json.Unmarshal(data, &params); err != nil {
		t.Fatal(err)
	}
	params["deleteMetrics"] = map[string]any{"002-delete": detail}
	write := func() {
		t.Helper()
		b, e := json.Marshal(params)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(paramsPath, b, 0600); e != nil {
			t.Fatal(e)
		}
	}
	write()
	m := a.readRealRun(filepath.Dir(dir), csvExportRunID, false)
	got, ok := m["delete_detail"].(*deletemetrics.Metrics)
	if !ok || got.Requests.FullSuccess != 3 || got.Objects.Accepted != 25 || got.Verification.RemovalConfirmed {
		t.Fatalf("request/object meaning changed: %v", m)
	}
	detail.Requests.FullSuccess = 2
	write()
	m = a.readRealRun(filepath.Dir(dir), csvExportRunID, false)
	if m["delete_detail"] != nil || m["delete_detail_error"] == nil {
		t.Fatal("invalid terminal evidence remained visible")
	}
}

func TestDeleteCustomPresetsAndConfigurationValidation(t *testing.T) {
	s, err := loadSettings(settingsFixture(t, `{"limits":{"delete":{"object_sizes":["2KiB"],"batch_sizes":[5]}}}`))
	if err != nil {
		t.Fatal(err)
	}
	a := &app{settings: s}
	o := deleteTestOptions()
	o.ObjectSize, o.Delete.BatchSize = "2KiB", 5
	if err := a.validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.Delete.BatchSize = 10
	if a.validateOptions(o) == nil {
		t.Fatal("default choice bypassed custom presets")
	}
	if !reflect.DeepEqual(a.limitsPayload()["delete"], s.Limits.Delete) {
		t.Fatal("published Delete choices differ")
	}
	for _, body := range []string{
		`{"limits":{"delete":{"batch_sizes":[0]}}}`, `{"limits":{"delete":{"batch_sizes":[1001]}}}`,
		`{"limits":{"delete":{"batch_sizes":[1,1]}}}`, `{"limits":{"delete":{"object_sizes":[]}}}`,
		`{"limits":{"delete":{"max_failure_percent":[101]}}}`, `{"limits":{"delete":{"max_failed_objects":[-1]}}}`,
		`{"limits":{"delete":{"verification_timeout_seconds":[0]}}}`, `{"limits":{"delete":{"failure_budget_grace_seconds":[-1]}}}`,
	} {
		if _, err := loadSettings(settingsFixture(t, body)); err == nil {
			t.Fatalf("accepted invalid presets %s", body)
		}
	}
}

func TestDeleteHistoryRetainsSettingsAfterRestart(t *testing.T) {
	a, _ := newDeleteResultsApp(t)
	o := deleteTestOptions()
	o.Delete.Cleanup = true
	job := map[string]any{keyRunID: csvExportRunID, keyStatus: jobStopped, keyOptions: o, "returncode": 1}
	active, err := a.savedRun(csvExportRunID, job, false)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(active[keyOptions], o) {
		t.Fatalf("active typed Delete settings were lost: %v", active[keyOptions])
	}
	if err := a.writeRunRecord(job); err != nil {
		t.Fatal(err)
	}
	restarted := newHistoryApp(t, a.root)
	item, err := restarted.savedRun(csvExportRunID, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if item[keyStatus] != jobStopped || jobWorkload(map[string]any{keyOptions: item[keyOptions]}) != "delete" {
		t.Fatalf("outcome/workload lost: %v", item)
	}
	b, err := json.Marshal(item[keyOptions])
	if err != nil {
		t.Fatal(err)
	}
	var restored options
	if err := json.Unmarshal(b, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored, o) {
		t.Fatalf("settings changed after restart: %+v; want %+v", restored, o)
	}
}

func TestLiveDeleteUsesOwnPhaseAndObjectDetail(t *testing.T) {
	entry := map[string]any{
		"sample_ts": "2026-10-22T12:00:04Z", "test_state": 1, "step_id": "002-delete", "op_type": "DELETE",
		"operations": map[string]any{"success_count": 3.0, "failed_count": 0.0, "success_rate_last": 1.5},
		"bandwidth":  map[string]any{"bytes_total": 0.0, "bytes_rate_last": 0.0},
		"delete": map[string]any{
			"objects":        map[string]any{"selected": 25.0, "attempted": 25.0, "accepted": 25.0, "failed": 0.0, "unattempted": 0.0, "unresolved": 0.0},
			"requests":       map[string]any{"attempted": 3.0, "full_success": 3.0, "partial": 0.0, "failed": 0.0, "unresolved": 0.0},
			"failure_policy": map[string]any{"outcome": "running"},
			"verification":   map[string]any{"removal_confirmed": false},
		},
	}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, []any{entry}) }))
	defer s.Close()
	a := &app{}
	job := map[string]any{keyRunID: "mt-dashboard-live-delete", keyStartedEpoch: 1.0, keyOptions: deleteTestOptions()}
	m := a.liveMetricsAt(job, s.URL)
	if m == nil || m[keyPhase] != "DELETE" || m[keyWorkloadType] != "delete" {
		t.Fatalf("wrong live phase: %v", m)
	}
	detail, ok := m["delete_detail"].(*deletemetrics.Metrics)
	if !ok || detail.Objects.Accepted != 25 || detail.Requests.FullSuccess != 3 {
		t.Fatalf("object/request units lost: %v", m)
	}
	row := m[keySamples].([]map[string]any)[0]
	if row[metricBandwidth] != nil {
		t.Fatal("live Delete bandwidth is not applicable")
	}
	entry["step_id"] = "003-cleanup"
	delete(entry, "delete")
	m = a.liveMetricsAt(job, s.URL)
	if m[keyPhase] != "CLEANUP" || m["delete_detail"] != nil {
		t.Fatalf("cleanup mixed with measurement: %v", m)
	}
}
