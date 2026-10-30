package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	// How old a live sample_ts may be before the dashboard labels it delayed.
	// The live poll is ~500 ms–2 s; 10 s means several missed refreshes.
	sampleStaleAfter = 10 * time.Second

	warnFleetPartial  = "fleet_partial"
	warnNodeNoData    = "node_no_data"
	warnSampleDelayed = "sample_delayed"
	warnMetricsGap    = "metrics_gap"
	warnFailedOps     = "failed_operations"
	dataPresent       = "present"
	dataNoData        = "no_data"
	dataDelayed       = "delayed"
	keyWarnings       = "warnings"
	keyDataStatus     = "data_status"
	keyNodesCount     = "nodes_count"
	keyNodesPresent   = "nodes_present"
	keyContributors   = "contributors_present"
	keyObserved       = "observed"
	keyCode           = "code"
	keySeverity       = "severity"
	keyAffectedHost   = "host"
	keyAffectedMetric = "metric"
	keyWarningSource  = "source"
)

// runWarning is one actionable observation about unreliable telemetry.
// Text must state what was observed; it must not invent a cause (SCRUM-21 AC4).
type runWarning struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Observed string `json:"observed"`
	Host     string `json:"host,omitempty"`
	Metric   string `json:"metric,omitempty"`
	Source   string `json:"source"`
}

func stringList(v any) []string {
	switch t := v.(type) {
	case []string:
		return append([]string(nil), t...)
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s := strings.TrimSpace(str(item)); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func sampleAge(ts string, now time.Time) (time.Duration, bool) {
	t, err := parseTimestamp(ts)
	if err != nil {
		return 0, false
	}
	age := now.Sub(t)
	if age < 0 {
		age = 0
	}
	return age, true
}

func annotateNodeDataStatus(row map[string]any, now time.Time) {
	if str(row[keyStatus]) != "reporting" {
		row[keyDataStatus] = dataNoData
		return
	}
	age, ok := sampleAge(str(row[keySampleTS]), now)
	if !ok {
		row[keyDataStatus] = dataPresent
		return
	}
	if age > sampleStaleAfter {
		row[keyDataStatus] = dataDelayed
		return
	}
	row[keyDataStatus] = dataPresent
}

// buildRunWarnings turns SPT/live fields the dashboard already has into
// observed warnings. It never invents a network or client failure cause.
func buildRunWarnings(metrics map[string]any, now time.Time) []runWarning {
	if metrics == nil {
		return nil
	}
	out := []runWarning{}
	seen := map[string]bool{}
	add := func(w runWarning) {
		key := w.Code + "|" + w.Host + "|" + w.Metric + "|" + w.Observed
		if seen[key] {
			return
		}
		seen[key] = true
		if w.Severity == "" {
			w.Severity = levelWarn
		}
		out = append(out, w)
	}

	if metrics["fleet_partial"] == true {
		parts := []string{"SPT fleet metrics report partial=true (aggregate incomplete or contributor evidence inconsistent)."}
		if n, ok := num(metrics, keyNodesCount); ok {
			parts = append(parts, "nodes_count="+str(n))
		}
		if present := stringList(metrics[keyNodesPresent]); len(present) > 0 {
			parts = append(parts, "nodes_present=["+strings.Join(present, ", ")+"]")
		}
		if contrib := stringList(metrics[keyContributors]); len(contrib) > 0 {
			parts = append(parts, "contributors_present=["+strings.Join(contrib, ", ")+"]")
		}
		add(runWarning{
			Code:     warnFleetPartial,
			Observed: strings.Join(parts, " "),
			Source:   "fleet_metrics",
			Metric:   "fleet_aggregate",
		})
	}

	active, _ := metrics[keyIsActive].(bool)
	samples, _ := metrics[keySamples].([]map[string]any)
	if active && len(samples) == 0 {
		add(runWarning{
			Code:     warnMetricsGap,
			Observed: "No live metric sample is available in this poll (empty samples while the run is active). This is a telemetry gap, not a measured value of zero.",
			Source:   "live_metrics",
			Metric:   "samples",
		})
	}

	updated := str(metrics[keyUpdatedAt])
	if updated == "" && len(samples) > 0 {
		updated = str(samples[0][keyTimestamp])
	}
	if active && updated != "" {
		if age, ok := sampleAge(updated, now); ok && age > sampleStaleAfter {
			add(runWarning{
				Code:     warnSampleDelayed,
				Observed: "Latest live metrics timestamp is " + updated + " (" + age.Truncate(time.Second).String() + " ago). Showing delayed data, not a fresh zero.",
				Source:   "live_metrics",
				Metric:   "updated_at",
			})
			metrics[keyDataStatus] = dataDelayed
		}
	}
	if _, ok := metrics[keyDataStatus]; !ok {
		if active && len(samples) == 0 {
			metrics[keyDataStatus] = dataNoData
		} else if len(samples) > 0 {
			metrics[keyDataStatus] = dataPresent
		}
	}

	if len(samples) > 0 {
		failed, hasFailed := num(samples[0], keyCountFailed)
		if hasFailed && failed > 0 {
			add(runWarning{
				Code:     warnFailedOps,
				Observed: "Live metrics report " + str(failed) + " failed operation(s) in the current sample.",
				Source:   "operations.failed_count",
				Metric:   metricFailed,
			})
		}
	}

	nodes, _ := metrics["nodes"].([]map[string]any)
	for _, row := range nodes {
		annotateNodeDataStatus(row, now)
		host := str(row[keyHost])
		switch str(row[keyDataStatus]) {
		case dataNoData:
			add(runWarning{
				Code:     warnNodeNoData,
				Observed: "Client machine " + host + ": SPT /metrics/json did not return a usable live sample in this poll. Metric cells show no data (not zero).",
				Host:     host,
				Source:   "node_metrics",
				Metric:   "node_sample",
			})
		case dataDelayed:
			add(runWarning{
				Code:     warnSampleDelayed,
				Observed: "Client machine " + host + ": latest sample_ts is " + str(row[keySampleTS]) + ". Treating per-node metrics as delayed.",
				Host:     host,
				Source:   "node_metrics",
				Metric:   "sample_ts",
			})
		}
		if str(row[keyStatus]) == "reporting" {
			if failed, ok := num(row, metricFailed); ok && failed > 0 {
				add(runWarning{
					Code:     warnFailedOps,
					Observed: "Client machine " + host + ": live metrics report " + str(failed) + " failed operation(s).",
					Host:     host,
					Source:   "node_metrics",
					Metric:   metricFailed,
				})
			}
		}
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Code != out[j].Code {
			return out[i].Code < out[j].Code
		}
		return out[i].Host < out[j].Host
	})
	return out
}

func warningsAsMaps(list []runWarning) []map[string]any {
	out := make([]map[string]any, 0, len(list))
	for _, w := range list {
		item := map[string]any{
			keyCode: w.Code, keySeverity: w.Severity, keyObserved: w.Observed, keyWarningSource: w.Source,
		}
		if w.Host != "" {
			item[keyAffectedHost] = w.Host
		}
		if w.Metric != "" {
			item[keyAffectedMetric] = w.Metric
		}
		out = append(out, item)
	}
	return out
}

// attachWarnings adds the warnings list to metrics and optionally remembers them for the run.
func (a *app) attachWarnings(metrics map[string]any, now time.Time) map[string]any {
	if metrics == nil {
		return nil
	}
	list := buildRunWarnings(metrics, now)
	metrics[keyWarnings] = warningsAsMaps(list)
	runID := str(metrics[keyRunID])
	if a != nil && runPattern.MatchString(runID) && len(list) > 0 {
		a.saveRunWarnings(runID, list)
	}
	return metrics
}

func (a *app) saveRunWarnings(runID string, list []runWarning) {
	if a.stateDir == "" || !runPattern.MatchString(runID) {
		return
	}
	b, err := json.Marshal(list)
	if err != nil {
		return
	}
	tmp := filepath.Join(a.stateDir, runID+".warnings.tmp")
	path := filepath.Join(a.stateDir, runID+".warnings.json")
	if os.WriteFile(tmp, b, 0600) != nil {
		return
	}
	_ = os.Chmod(tmp, 0600)
	_ = os.Rename(tmp, path)
}

func (a *app) loadRunWarnings(runID string) []map[string]any {
	if a == nil || a.stateDir == "" || !runPattern.MatchString(runID) {
		return nil
	}
	path := filepath.Join(a.stateDir, runID+".warnings.json")
	info, err := os.Stat(path)
	if err != nil || info.Size() > 256<<10 {
		return nil
	}
	b, err := os.ReadFile(path) // #nosec G304 -- runID matches runPattern
	if err != nil {
		return nil
	}
	var list []runWarning
	if json.Unmarshal(b, &list) != nil {
		return nil
	}
	return warningsAsMaps(list)
}
