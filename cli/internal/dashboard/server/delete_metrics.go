package server

import (
	"encoding/json"
	"path/filepath"
	"strings"

	"github.com/dell/storage-performance-tool/cli/internal/deletemetrics"
)

func deletePhase(step, op string) string {
	name := strings.ToLower(filepath.Base(step))
	switch {
	case strings.Contains(name, "cleanup"):
		return "CLEANUP"
	case strings.Contains(name, "seed"), strings.Contains(name, "create"), strings.EqualFold(op, "CREATE"):
		return "SEED"
	case strings.Contains(name, "delete"), strings.EqualFold(op, "DELETE"):
		return "DELETE"
	default:
		return "SPT"
	}
}

func samplePhase(sample map[string]any, workload string) string {
	if workload == "delete" {
		return deletePhase(str(sample[keyStepID]), firstNonempty(str(sample[keyPhase]), str(sample[keyOpType])))
	}
	return strings.ToUpper(str(sample[keyOpType]))
}

func savedDeleteDetails(params []byte) map[string]*deletemetrics.Metrics {
	var view struct {
		DeleteMetrics map[string]*deletemetrics.Metrics `json:"deleteMetrics"`
	}
	if json.Unmarshal(params, &view) != nil {
		return nil
	}
	return view.DeleteMetrics
}

func liveDeleteDetail(entry map[string]any) *deletemetrics.Metrics {
	raw, ok := entry["delete"].(map[string]any)
	if !ok {
		return nil
	}
	for group, names := range map[string][]string{
		"objects":  {"selected", "attempted", "accepted", "failed", "unattempted", "unresolved"},
		"requests": {"attempted", "full_success", "partial", "failed", "unresolved"},
	} {
		values := mapValue(raw[group])
		for _, name := range names {
			if value, ok := num(values, name); !ok || value < 0 {
				return nil
			}
		}
	}
	if str(mapValue(raw["failure_policy"])["outcome"]) == "" {
		return nil
	}
	if _, ok := mapValue(raw["verification"])["removal_confirmed"].(bool); !ok {
		return nil
	}
	var detail deletemetrics.Metrics
	data, err := json.Marshal(raw)
	if err != nil || json.Unmarshal(data, &detail) != nil {
		return nil
	}
	return &detail
}

func exportPhase(row map[string]any, workload string) string {
	if workload == "delete" {
		return samplePhase(row, workload)
	}
	return phaseCodeForBackend(str(row[keyOpType]))
}
func exportPhaseName(phase, workload string) string {
	if workload == "delete" {
		return phase
	}
	return phaseCodeForBackend(phase)
}
