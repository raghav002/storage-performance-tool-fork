package server

import (
	"encoding/json"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func (a *app) readRealRun(runDir, runID string, active bool) map[string]any {
	abs, _ := filepath.Abs(runDir)
	root, _ := filepath.Abs(a.results)
	parent := filepath.Dir(abs)
	if parent != root {
		return nil
	}
	info, e := os.Stat(abs)
	if e != nil || !info.IsDir() {
		return nil
	}
	folders := []string{}
	if regularFile(filepath.Join(abs, "spt_run_params.json")) {
		folders = append(folders, abs)
	} else {
		entries, _ := os.ReadDir(abs)
		for _, item := range entries {
			if !item.IsDir() {
				continue
			}
			child := filepath.Join(abs, item.Name())
			if regularFile(filepath.Join(child, "spt_run_params.json")) {
				folders = append(folders, child)
			}
		}
	}
	sort.Slice(folders, func(i, j int) bool {
		a, _ := os.Stat(folders[i])
		b, _ := os.Stat(folders[j])
		return a != nil && b != nil && a.ModTime().After(b.ModTime())
	})
	for _, folder := range folders {
		b, err := os.ReadFile(filepath.Join(folder, "spt_run_params.json")) // #nosec G304 -- folder is the checked run directory or a child listed from it
		if err != nil {
			continue
		}
		var params map[string]any
		if json.Unmarshal(b, &params) != nil {
			continue
		}
		workload := strings.ToLower(strings.TrimSpace(str(params["workloadType"])))
		if workload == "" {
			workload = strings.ToLower(strings.TrimSpace(str(params["workload"])))
		}
		if workload == "" || workload == "mock" {
			continue
		}
		path, aggregate := a.metricsFiles(folder, active)
		if path == "" {
			continue
		}
		result, err := a.parseMetricsFile(path, filepath.Base(folder), workload, active, aggregate)
		if err != nil {
			continue
		}
		result[keyRunID] = runID
		history := map[string][]map[string]any{}
		files, _ := filepath.Glob(filepath.Join(folder, "*.metrics.csv"))
		sort.Strings(files)
		for _, p := range files {
			part, err := a.parseMetricsFile(p, filepath.Base(folder), workload, active, false)
			if err != nil {
				continue
			}
			for _, sample := range part[keySamples].([]map[string]any) {
				phase := strings.ToUpper(str(sample["op_type"]))
				if validPhase(phase) {
					history[phase] = append(history[phase], sample)
				}
			}
		}
		captured := map[string][]map[string]any{}
		for _, sample := range a.savedLiveSamples(runID) {
			phase := strings.ToUpper(str(sample["op_type"]))
			if validPhase(phase) {
				captured[phase] = append(captured[phase], sample)
			}
		}
		for phase, samples := range captured {
			if len(samples) > len(history[phase]) {
				history[phase] = samples
			}
		}
		chart := []map[string]any{}
		for _, samples := range history {
			chart = append(chart, samples...)
		}
		sort.Slice(chart, func(i, j int) bool { return str(chart[i][keyTimestamp]) < str(chart[j][keyTimestamp]) })
		if len(chart) > maxSamples {
			chart = chart[len(chart)-maxSamples:]
		}
		result[keyChartSamples] = chart
		if !active {
			totals, _ := filepath.Glob(filepath.Join(folder, "*.metrics.total.csv"))
			sort.Strings(totals)
			summaries := []map[string]any{}
			for _, p := range totals {
				low := strings.ToLower(filepath.Base(p))
				phase := "SPT"
				for _, name := range [][2]string{{"create", "Create"}, {"verify", phaseVerifyLabel}, {"delete", "Delete"}} {
					if strings.Contains(low, name[0]) {
						phase = name[1]
						break
					}
				}
				data, err := a.parseMetricsFile(p, filepath.Base(folder), workload, false, true)
				if err != nil {
					continue
				}
				rows := data[keySamples].([]map[string]any)
				if len(rows) == 0 {
					continue
				}
				s := rows[len(rows)-1]
				item := map[string]any{keyPhase: phase, keySourceFile: filepath.Base(p), "successful_ops": s[keyCumulativeOps], "failed_ops": s[keyCountFailed], "iops": s[keyIntervalIOPS], metricBandwidth: s[metricBandwidth], metricP50Latency: s[metricP50Latency]}
				for _, k := range []string{keyTimestamp, "duration_seconds", "bytes_processed", "concurrency", "concurrency_mean", "node_count", "corrupt_ops", "latency_mean_us", "latency_min_us", "latency_max_us", "latency_p99_us"} {
					item[k] = s[k]
				}
				summaries = append(summaries, item)
			}
			result["phase_summaries"] = summaries
			failed := 0.0
			all := len(summaries) > 0
			for _, s := range summaries {
				v, ok := num(s, "failed_ops")
				if !ok {
					all = false
					break
				}
				failed += v
			}
			if all {
				result["total_failed"] = failed
			} else {
				result["total_failed"] = nil
			}
		}
		return result
	}
	return nil
}

func validPhase(p string) bool {
	return p == phaseCreate || p == phaseVerify || p == "READ" || p == phaseDelete
}

func (a *app) savedLiveSamples(runID string) []map[string]any {
	if !runPattern.MatchString(runID) {
		return nil
	}
	path := filepath.Join(a.stateDir, runID+".samples.json")
	info, e := os.Stat(path)
	if e != nil || info.Size() > maxSamplesBytes {
		return nil
	}
	b, e := os.ReadFile(path) // #nosec G304 -- runID matches runPattern above, so path stays inside the state directory
	if e != nil {
		return nil
	}
	var list []map[string]any
	if json.Unmarshal(b, &list) != nil {
		return nil
	}
	if len(list) > maxSamples {
		list = list[len(list)-maxSamples:]
	}
	out := []map[string]any{}
	for _, m := range list {
		if _, ok := m[keyTimestamp].(string); ok {
			out = append(out, m)
		}
	}
	return out
}

func (a *app) rememberLive(metrics map[string]any) map[string]any {
	runID := str(metrics[keyRunID])
	if a.liveRunID != runID {
		a.liveRunID = runID
		a.liveSamples = a.savedLiveSamples(runID)
		a.liveSignature = ""
	}
	changed := false
	for _, raw := range metrics[keySamples].([]map[string]any) {
		keys := []string{"step_id", keyCumulativeOps, keyCountFailed, keyIntervalIOPS, metricBandwidth, metricP50Latency}
		vals := make([]any, 0, len(keys))
		for _, k := range keys {
			vals = append(vals, raw[k])
		}
		b, _ := json.Marshal(vals)
		sig := string(b)
		if sig != a.liveSignature {
			a.liveSamples = append(a.liveSamples, raw)
			if len(a.liveSamples) > maxSamples {
				a.liveSamples = a.liveSamples[len(a.liveSamples)-maxSamples:]
			}
			a.liveSignature = sig
			changed = true
		}
	}
	if changed && runPattern.MatchString(runID) {
		b, _ := json.Marshal(a.liveSamples)
		tmp := filepath.Join(a.stateDir, runID+".samples.tmp")
		path := filepath.Join(a.stateDir, runID+".samples.json")
		if os.WriteFile(tmp, b, 0600) == nil {
			_ = os.Chmod(tmp, 0600)
			_ = os.Rename(tmp, path)
		}
	}
	out := cloneMap(metrics)
	out[keySamples] = latestSample(a.liveSamples)
	out[keyChartSamples] = append([]map[string]any(nil), a.liveSamples...)
	return out
}

// latestSample keeps the full live history out of "samples"; "chart_samples" already carries it.
func latestSample(samples []map[string]any) []map[string]any {
	if len(samples) == 0 {
		return []map[string]any{}
	}
	return []map[string]any{samples[len(samples)-1]}
}

func (a *app) liveMetrics(state map[string]any) map[string]any {
	metricsURL := a.metricsURL
	if metricsURL == "" {
		metricsURL = a.metricsEndpoint()
	}
	return a.liveMetricsAt(state, metricsURL)
}

func (a *app) liveMetricsAt(state map[string]any, metricsURL string) map[string]any {
	started, ok := num(state, "started_epoch")
	if !ok {
		return nil
	}
	client := &http.Client{Timeout: 450 * time.Millisecond}
	req, _ := http.NewRequest(http.MethodGet, metricsURL, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxMetricsBytes+1))
	if err != nil || len(body) > maxMetricsBytes || resp.StatusCode != 200 {
		return nil
	}
	var payload any
	if json.Unmarshal(body, &payload) != nil {
		return nil
	}
	entries := []any{}
	if list, ok := payload.([]any); ok {
		entries = list
	} else {
		entries = append(entries, payload)
	}
	fresh := []map[string]any{}
	for _, item := range entries {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		t, err := parseTimestamp(str(m["sample_ts"]))
		if err != nil {
			continue
		}
		stateN := numberValue(m, "test_state")
		step := str(m["step_id"])
		if float64(t.UnixNano())/1e9 < started || stateN != 1 || m["terminal"] == true || step == "" {
			continue
		}
		fresh = append(fresh, m)
	}
	if len(fresh) == 0 {
		return nil
	}
	sort.Slice(fresh, func(i, j int) bool { return str(fresh[i]["sample_ts"]) > str(fresh[j]["sample_ts"]) })
	entry := map[string]any(nil)
	for _, m := range fresh {
		if m["scope"] == "fleet" || m["scope"] == "cluster" {
			entry = m
			break
		}
	}
	if entry == nil {
		for _, m := range fresh {
			if m["role"] == "entry" {
				entry = m
				break
			}
		}
	}
	if entry == nil {
		entry = fresh[0]
	}
	ops := mapValue(entry["operations"])
	bandwidth := mapValue(entry["bandwidth"])
	timing := mapValue(entry["timing"])
	latency := mapValue(timing["latency"])
	success := numberValue(ops, "success_count")
	failed := numberValue(ops, "failed_count")
	elapsed := numberValue(entry, "elapsed_time_seconds")
	bytesTotal := numberValue(bandwidth, "bytes_total")
	iops, iok := num(ops, "success_rate_last")
	if !iok && elapsed > 0 {
		iops = success / elapsed
		iok = true
	}
	byteRate, bok := num(bandwidth, "bytes_rate_last")
	if !bok && elapsed > 0 {
		byteRate = bytesTotal / elapsed
		bok = true
	}
	var bw any
	if bok {
		bw = byteRate / (1024 * 1024)
	}
	var p50 any
	if numberValue(latency, "count") > 0 {
		if measuredP50, ok := num(latency, "p50_us"); ok {
			p50 = measuredP50
		}
	}
	ts, err := parseTimestamp(str(entry["sample_ts"]))
	if err != nil {
		return nil
	}
	stepElapsed := math.Max(0, float64(ts.UnixNano())/1e9-started)
	var iopsAny any
	if iok {
		iopsAny = iops
	}
	sample := map[string]any{keyTimestamp: ts.UTC().Format(time.RFC3339Nano), keyElapsedSeconds: stepElapsed, keyCumulativeOps: success, keyCountFailed: failed, "average_iops": any(nil), keyIntervalIOPS: iopsAny, metricBandwidth: bw, "bandwidth_unit": "MiB/s", keySourceFile: metricsContract, metricP50Latency: p50, "step_id": str(entry["step_id"]), "op_type": str(entry["op_type"]), "completion_percent": optionalMetric(entry, "completion_percent")}
	if elapsed > 0 {
		sample["average_iops"] = success / elapsed
	}
	has := success > 0 || failed > 0 || numberValue(latency, "count") > 0 || bytesTotal > 0
	out := map[string]any{keyRunID: str(state[keyRunID]), keyWorkloadType: driverWriteVerify, keySourceFile: metricsContract, keyUpdatedAt: sample[keyTimestamp], keyIsActive: true, keyIsAggregate: false, keyPhase: firstNonempty(str(sample["op_type"]), str(sample["step_id"])), "phase_id": str(sample["step_id"]), "progress_percent": sample["completion_percent"], keySamples: []map[string]any{}}
	if !has {
		return out
	}
	out[keySamples] = []map[string]any{sample}
	return out
}

func optionalMetric(m map[string]any, key string) any {
	if v, ok := num(m, key); ok {
		return v
	}
	return nil
}

func firstNonempty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func (a *app) collectLiveHistory(runID string) {
	defer a.processes.Done()
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		a.mu.Lock()
		if a.activeJob == nil || a.activeJob[keyRunID] != runID || a.activeJob[keyStatus] != jobRunning {
			a.mu.Unlock()
			return
		}
		state := cloneMap(a.activeJob)
		a.mu.Unlock()
		if metrics := a.liveMetrics(state); metrics != nil {
			a.mu.Lock()
			if a.activeJob != nil && a.activeJob[keyRunID] == runID {
				_ = a.rememberLive(metrics)
			}
			a.mu.Unlock()
		}
		<-ticker.C
	}
}
