package main

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestValidateOptionsBounds(t *testing.T) {
	good := options{100, "1MiB", 1, 60}
	if err := validateOptions(good); err != nil {
		t.Fatal(err)
	}
	bad := []options{{1000, "1MiB", 1, 60}, {100, "100MiB", 1, 60}, {100, "1MiB", 20, 60}, {100, "1MiB", 1, 999}}
	for _, got := range bad {
		if validateOptions(got) == nil {
			t.Errorf("accepted unsafe settings: %+v", got)
		}
	}
}

func TestParseMetricsIntervalAndAggregate(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "create.metrics.csv")
	header := []string{"DateTimeISO8601", "OpType", "Concurrency", "NodeCount", "ConcurrencyCurr", "ConcurrencyMean", "CountSucc", "CountFail", "Size", "StepDuration[s]", "DurationSum[s]", "TPAvg[op/s]", "TPLast[op/s]", "BWAvg[MiB/s]", "BWLast[MiB/s]", "LatencyAvg[us]", "LatencyMed[us]", "LatencyQ_0.5[us]", "LatencyQ_0.99[us]"}
	row := []string{"2026-09-30T19:00:01+00:00", "CREATE", "1", "1", "1", "1", "10", "0", "10485760", "2", "1", "5", "8", "5", "8", "99", "42", "", "120"}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w := csv.NewWriter(f)
	_ = w.Write(header)
	_ = w.Write(row)
	w.Flush()
	_ = f.Close()
	a := &app{}
	interval, err := a.parseMetricsFile(path, "run", "write-verify", false, false)
	if err != nil {
		t.Fatal(err)
	}
	total, err := a.parseMetricsFile(path, "run", "write-verify", false, true)
	if err != nil {
		t.Fatal(err)
	}
	i := interval["samples"].([]map[string]any)[0]
	s := total["samples"].([]map[string]any)[0]
	if i["interval_iops"] != float64(8) || i["bandwidth_mib_s"] != float64(8) || i["p50_latency_us"] != float64(42) {
		t.Fatalf("wrong interval row: %#v", i)
	}
	if s["interval_iops"] != float64(5) || s["bandwidth_mib_s"] != float64(5) {
		t.Fatalf("wrong aggregate row: %#v", s)
	}
}

func TestLiveHistoryPersistenceAndDeduplication(t *testing.T) {
	a := &app{stateDir: t.TempDir()}
	sample := map[string]any{"timestamp": "2026-09-30T19:00:01Z", "step_id": "create", "cumulative_ops": 10, "count_failed": 0, "interval_iops": 8, "bandwidth_mib_s": 8, "p50_latency_us": 42, "op_type": "CREATE"}
	metrics := map[string]any{"run_id": "mt-isolated-test", "samples": []map[string]any{sample}}
	first := a.rememberLive(metrics)
	second := a.rememberLive(metrics)
	if len(first["chart_samples"].([]map[string]any)) != 1 || len(second["chart_samples"].([]map[string]any)) != 1 {
		t.Fatal("duplicate live measurement was retained")
	}
	a.liveRunID = ""
	a.liveSamples = nil
	recovered := a.rememberLive(map[string]any{"run_id": "mt-isolated-test", "samples": []map[string]any{}})
	rows := recovered["chart_samples"].([]map[string]any)
	if len(rows) != 1 || rows[0]["step_id"] != "create" || numberValue(rows[0], "interval_iops", 0) != 8 {
		t.Fatalf("saved sample was not recovered: %#v", recovered)
	}
}

func TestRetainedLiveMetricsRemainAvailableBetweenPhases(t *testing.T) {
	sample := map[string]any{"timestamp": "2026-10-07T17:02:15Z", "op_type": "CREATE", "cumulative_ops": float64(100)}
	retained := retainedLiveMetrics("mt-dashboard-run-123", "mt-dashboard-run-123", []map[string]any{sample})
	if retained == nil || len(retained["chart_samples"].([]map[string]any)) != 1 {
		t.Fatalf("live chart history was not retained: %#v", retained)
	}
	if got := retainedLiveMetrics("mt-dashboard-other-456", "mt-dashboard-run-123", []map[string]any{sample}); got != nil {
		t.Fatalf("returned samples from a different run: %#v", got)
	}
}

func TestRunOriginGate(t *testing.T) {
	a := &app{port: "8000"}
	for _, test := range []struct {
		host, origin string
		want         bool
	}{{"localhost:8000", "http://localhost:8000", true}, {"127.0.0.1:8000", "http://127.0.0.1:8000", true}, {"evil.example", "http://evil.example", false}, {"localhost:8000", "https://localhost:8000", false}, {"localhost:8000", "http://localhost:8001", false}} {
		r := httptest.NewRequest("POST", "/api/runs", nil)
		r.Host = test.host
		r.Header.Set("Origin", test.origin)
		if got := a.sameOrigin(r); got != test.want {
			t.Errorf("sameOrigin(%q,%q)=%v; want %v", test.host, test.origin, got, test.want)
		}
	}
}

func TestLiveMetricsRatesAndLatency(t *testing.T) {
	stamp := time.Now().UTC().Truncate(time.Second)
	base := map[string]any{"sample_ts": stamp.Format(time.RFC3339), "test_state": 1, "step_id": "create-step", "scope": "node", "role": "entry", "op_type": "CREATE", "elapsed_time_seconds": 2.0,
		"operations": map[string]any{"success_count": 10.0, "failed_count": 0.0, "success_rate_last": 8.0},
		"bandwidth":  map[string]any{"bytes_total": 10.0 * 1048576, "bytes_rate_last": 8.0 * 1048576},
		"timing":     map[string]any{"latency": map[string]any{"count": 10.0, "p50_us": 42.0}}}
	read := func(entries any) map[string]any {
		t.Helper()
		body, _ := json.Marshal(entries)
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
		defer server.Close()
		a := &app{metricsURL: server.URL}
		state := map[string]any{"started_epoch": float64(stamp.Add(-time.Minute).Unix()), "run_id": "mt-isolated-test"}
		return a.liveMetrics(state)
	}

	metrics := read(base)
	if metrics == nil {
		t.Fatal("live metric was not accepted")
	}
	sample := metrics["samples"].([]map[string]any)[0]
	if numberValue(sample, "interval_iops", -1) != 8 || numberValue(sample, "bandwidth_mib_s", -1) != 8 || numberValue(sample, "average_iops", -1) != 5 || numberValue(sample, "p50_latency_us", -1) != 42 {
		t.Fatalf("wrong measured live values: %#v", sample)
	}

	zero := map[string]any{}
	for k, v := range base {
		zero[k] = v
	}
	zero["operations"] = map[string]any{"success_count": 10.0, "failed_count": 0.0, "success_rate_last": 0.0}
	zero["bandwidth"] = map[string]any{"bytes_total": 10.0 * 1048576, "bytes_rate_last": 0.0}
	zeroSample := read(zero)["samples"].([]map[string]any)[0]
	if numberValue(zeroSample, "interval_iops", -1) != 0 || numberValue(zeroSample, "bandwidth_mib_s", -1) != 0 {
		t.Fatalf("real zero rate was replaced: %#v", zeroSample)
	}

	missing := map[string]any{}
	for k, v := range base {
		missing[k] = v
	}
	missing["operations"] = map[string]any{"success_count": 10.0, "failed_count": 0.0}
	missing["bandwidth"] = map[string]any{"bytes_total": 10.0 * 1048576}
	missingSample := read(missing)["samples"].([]map[string]any)[0]
	if numberValue(missingSample, "interval_iops", -1) != 5 || numberValue(missingSample, "bandwidth_mib_s", -1) != 5 {
		t.Fatalf("missing rates were not derived from measurements: %#v", missingSample)
	}

	noMedian := map[string]any{}
	for k, v := range base {
		noMedian[k] = v
	}
	noMedian["timing"] = map[string]any{"latency": map[string]any{"count": 10.0, "mean_us": 999.0}}
	if got := read(noMedian)["samples"].([]map[string]any)[0]["p50_latency_us"]; got != nil {
		t.Fatalf("mean latency was incorrectly used as P50: %#v", got)
	}

	old := map[string]any{}
	for k, v := range base {
		old[k] = v
	}
	old["test_state"] = 2
	old["terminal"] = true
	old["scope"] = "fleet"
	old["step_id"] = "old-create"
	if got := read(old); got != nil {
		t.Fatalf("terminal SPT sample was accepted: %#v", got)
	}
	active := map[string]any{}
	for k, v := range base {
		active[k] = v
	}
	active["op_type"] = "READ"
	active["step_id"] = "verify-step"
	combined := read([]any{old, active})
	if combined == nil || combined["phase"] != "READ" {
		t.Fatalf("active phase did not win over retained terminal data: %#v", combined)
	}

	if !strings.Contains(str(sample["source_file"]), "live metrics") {
		t.Fatalf("live source provenance missing: %#v", sample)
	}
}
