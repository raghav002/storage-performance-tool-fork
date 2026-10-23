package server

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func (a *app) currentState() (map[string]any, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	state := a.activeJob
	// Recover completed runs too, so a service restart preserves their public
	// settings, timestamps, and outcome alongside the saved measurements.
	if state == nil && !a.lockBusy() {
		state = a.readStateFile()
		if state != nil {
			a.activeJob = state
		}
	}
	if state == nil && a.lockBusy() {
		state = a.readStateFile()
		if state != nil {
			a.activeJob = state
			state["status"] = "running"
			if epoch, ok := num(state, "started_epoch"); ok {
				state["elapsed_seconds"] = int(time.Now().Unix() - int64(epoch))
			}
		}
	}
	if state != nil && str(state["status"]) == jobRunning && a.activeCmd == nil && !a.lockBusy() {
		state = a.markInterrupted(state)
	}
	if state != nil && str(state["status"]) == "running" {
		state = cloneMap(state)
		if epoch, ok := num(state, "started_epoch"); ok {
			state["elapsed_seconds"] = math.Max(0, float64(time.Now().Unix())-epoch)
		}
		state["phase"] = a.phaseFromOutput(str(state["results_dir"]))
		result := a.readRealRun(str(state["results_dir"]), str(state["run_id"]), true)
		live := a.liveMetrics(state)
		if live != nil {
			result = a.rememberLive(live)
			phase := strings.ToLower(str(live["phase"]))
			label := "Create / write"
			if strings.Contains(phase, "verify") || strings.Contains(phase, "read") {
				label = "Verify"
			}
			if strings.Contains(phase, "delete") || strings.Contains(phase, "cleanup") {
				label = "Cleanup"
			}
			state["phase"] = label
			ss := live["samples"].([]map[string]any)
			if len(ss) > 0 {
				sample := ss[0]
				state["message"] = fmt.Sprintf("SPT live %s metrics: %.0f successful, %.0f failed operations.", strings.ToLower(label), numberValue(sample, "cumulative_ops", 0), numberValue(sample, "count_failed", 0))
			} else {
				state["message"] = "SPT is in the " + strings.ToLower(label) + " phase; waiting for its first measured operation."
			}
			_ = a.writeState(state)
		} else {
			retained := retainedLiveMetrics(str(state["run_id"]), a.liveRunID, a.liveSamples)
			if result == nil {
				if retained != nil {
					result = retained
					result["source_file"] = "Last SPT live metrics · waiting for next phase"
					state["phase"] = "Finalizing results"
					state["message"] = "SPT is moving between phases; the last recorded measurements remain visible."
					_ = a.writeState(state)
				} else {
					result = map[string]any{"run_id": state["run_id"], "workload_type": "write-verify", "source_file": "Waiting for SPT live metrics", "updated_at": utcNow(), "is_active": true, "is_aggregate": false, "samples": []map[string]any{}, "chart_samples": []map[string]any{}}
				}
			} else {
				result["is_active"] = true
				result["is_aggregate"] = false
				chart, _ := result["chart_samples"].([]map[string]any)
				if len(chart) == 0 && retained != nil {
					result["chart_samples"] = retained["chart_samples"]
					if len(result["samples"].([]map[string]any)) == 0 {
						result["samples"] = retained["samples"]
					}
					result["source_file"] = "Last SPT live metrics · waiting for next phase"
					state["phase"] = "Finalizing results"
					state["message"] = "SPT is moving between phases; the last recorded measurements remain visible."
					_ = a.writeState(state)
				}
			}
		}
		a.activeJob = state
		return a.stateResponse(publicJob(state), result), nil
	}
	if state != nil && str(state["status"]) == "running" && !a.lockBusy() {
		state = a.readStateFile()
		if state == nil {
			state = a.activeJob
		}
		if state != nil {
			state = a.markInterrupted(state)
		}
	}
	if state != nil {
		return a.stateResponse(publicJob(state), a.readRealRun(str(state["results_dir"]), str(state["run_id"]), false)), nil
	}
	return a.stateResponse(nil, a.latestSavedRun()), nil
}

func (a *app) stateResponse(job, metrics map[string]any) map[string]any {
	target := a.targetConfiguration()
	return map[string]any{"job": job, "metrics": metrics, "target": target, "storage": a.storageState(target), "limits": a.limitsPayload(), "branding": a.effectiveSettings().Branding}
}

func retainedLiveMetrics(runID, liveRunID string, samples []map[string]any) map[string]any {
	if runID == "" || runID != liveRunID || len(samples) == 0 {
		return nil
	}
	copy := append([]map[string]any(nil), samples...)
	return map[string]any{
		"run_id": runID, "workload_type": "write-verify", "updated_at": copy[len(copy)-1]["timestamp"],
		"is_active": true, "is_aggregate": false, "samples": latestSample(copy),
		"chart_samples": copy,
	}
}

func (a *app) latestSavedRun() map[string]any {
	entries, e := os.ReadDir(a.results)
	if e != nil {
		return nil
	}
	dirs := []string{}
	for _, ent := range entries {
		if ent.IsDir() && strings.HasPrefix(ent.Name(), "mt-") {
			dirs = append(dirs, filepath.Join(a.results, ent.Name()))
		}
	}
	sort.Slice(dirs, func(i, j int) bool {
		x, _ := os.Stat(dirs[i])
		y, _ := os.Stat(dirs[j])
		return x != nil && y != nil && x.ModTime().After(y.ModTime())
	})
	if len(dirs) > 200 {
		dirs = dirs[:200]
	}
	for _, dir := range dirs {
		r := a.readRealRun(dir, filepath.Base(dir), false)
		if r != nil && len(r["samples"].([]map[string]any)) > 0 {
			return r
		}
	}
	return nil
}

func (a *app) phaseFromOutput(runDir string) string {
	files := []string{}
	_ = filepath.WalkDir(runDir, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(path, ".metrics.csv") && !strings.HasSuffix(path, ".total.csv") {
			files = append(files, path)
		}
		return nil
	})
	if len(files) == 0 {
		return "SPT setup"
	}
	sort.Slice(files, func(i, j int) bool {
		x, _ := os.Stat(files[i])
		y, _ := os.Stat(files[j])
		return x != nil && y != nil && x.ModTime().After(y.ModTime())
	})
	name := strings.ToLower(filepath.Base(files[0]))
	if strings.Contains(name, "delete") || strings.Contains(name, "cleanup") {
		return "Cleanup"
	}
	if strings.Contains(name, "verify") || strings.Contains(name, "read") {
		return "Verify"
	}
	if strings.Contains(name, "create") || strings.Contains(name, "write") {
		return "Create / write"
	}
	return "SPT metrics"
}
