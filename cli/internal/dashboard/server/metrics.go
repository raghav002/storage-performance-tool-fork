package server

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

func parseNumber(row map[string]string, keys ...string) (float64, bool) {
	for _, k := range keys {
		v := strings.TrimSpace(row[k])
		if v == "" {
			continue
		}
		n, e := strconv.ParseFloat(v, 64)
		if e == nil && !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n, true
		}
	}
	return 0, false
}

func optNumber(row map[string]string, keys ...string) any {
	if n, ok := parseNumber(row, keys...); ok {
		return n
	}
	return nil
}

func num(m map[string]any, key string) (float64, bool) {
	switch v := m[key].(type) {
	case float64:
		if !math.IsNaN(v) && !math.IsInf(v, 0) {
			return v, true
		}
	case int:
		return float64(v), true
	case json.Number:
		n, e := v.Float64()
		return n, e == nil
	case string:
		n, e := strconv.ParseFloat(v, 64)
		return n, e == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
	}
	return 0, false
}

func str(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

func mapValue(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

// numberValue returns m[key] as a number, or 0 when it is missing or not numeric.
func numberValue(m map[string]any, key string) float64 {
	if n, ok := num(m, key); ok {
		return n
	}
	return 0
}

func (a *app) metricsFiles(runDir string, active bool) (string, bool) {
	entries, _ := os.ReadDir(runDir)
	paths := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.Contains(e.Name(), ".metrics") && strings.HasSuffix(e.Name(), ".csv") {
			paths = append(paths, filepath.Join(runDir, e.Name()))
		}
	}
	if len(paths) == 0 {
		return "", false
	}
	eligible := func(items []string) []string {
		create := []string{}
		pool := []string{}
		for _, p := range items {
			n := strings.ToLower(filepath.Base(p))
			if strings.Contains(n, "create") {
				create = append(create, p)
			}
			if !strings.Contains(n, "delete") && !strings.Contains(n, "cleanup") {
				pool = append(pool, p)
			}
		}
		if len(create) > 0 {
			return create
		}
		if len(pool) > 0 {
			return pool
		}
		return items
	}
	pool := []string{}
	aggregate := false
	for _, p := range paths {
		total := strings.HasSuffix(p, ".metrics.total.csv")
		if active && !total {
			pool = append(pool, p)
		}
		if !active && total {
			pool = append(pool, p)
		}
	}
	if !active && len(pool) > 0 {
		aggregate = true
	} else if !active {
		pool = nil
		for _, p := range paths {
			if !strings.HasSuffix(p, ".total.csv") {
				pool = append(pool, p)
			}
		}
	}
	pool = eligible(pool)
	if len(pool) == 0 {
		return "", false
	}
	sort.Slice(pool, func(i, j int) bool {
		a, _ := os.Stat(pool[i])
		b, _ := os.Stat(pool[j])
		if a == nil {
			return false
		}
		if b == nil {
			return true
		}
		return a.ModTime().After(b.ModTime())
	})
	return pool[0], aggregate
}

func (a *app) parseMetricsFile(path, runID, workload string, active, aggregate bool) (map[string]any, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxCSVBytes {
		return nil, userError("SPT metrics file exceeded the dashboard's 10 MB read limit.")
	}
	f, err := os.Open(path) // #nosec G304 -- metrics file found by listing a run directory under the results directory
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	reader := csv.NewReader(io.LimitReader(f, maxCSVBytes+1))
	reader.FieldsPerRecord = -1
	headers, err := reader.Read()
	if err != nil {
		return nil, err
	}
	samples := []map[string]any{}
	start := time.Time{}
	for {
		record, e := reader.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			continue
		}
		raw := map[string]string{}
		for i, h := range headers {
			if i < len(record) {
				raw[h] = record[i]
			}
		}
		tsraw := strings.TrimSpace(raw["DateTimeISO8601"])
		ts, te := parseTimestamp(tsraw)
		if te != nil {
			continue
		}
		if start.IsZero() {
			start = ts
		}
		succ, _ := parseNumber(raw, "CountSucc")
		failed, _ := parseNumber(raw, "CountFail")
		dur, _ := parseNumber(raw, "DurationSum[s]")
		conc, _ := parseNumber(raw, "ConcurrencyCurr")
		if succ == 0 && failed == 0 && dur == 0 && conc == 0 {
			continue
		}
		avg, ok := parseNumber(raw, "TPAvg[op/s]")
		if !ok {
			continue
		}
		measured := avg
		if !aggregate {
			if x, ok := parseNumber(raw, "TPLast[op/s]", "TPAvg[op/s]"); ok {
				measured = x
			}
		}
		bwKeys := []string{"BWAvg[MiB/s]"}
		if !aggregate {
			bwKeys = []string{"BWLast[MiB/s]", "BWAvg[MiB/s]"}
		}
		bw, bwok := parseNumber(raw, bwKeys...)
		if !bwok {
			continue
		}
		elapsed := 0.0
		if aggregate {
			elapsed, _ = parseNumber(raw, "StepDuration[s]")
		} else {
			elapsed = ts.Sub(start).Seconds()
		}
		p50 := optNumber(raw, "LatencyMed[us]", "LatencyQ_0.5[us]")
		samples = append(samples, map[string]any{"timestamp": ts.UTC().Format(time.RFC3339Nano), "elapsed_seconds": elapsed, "cumulative_ops": succ, "count_failed": failed, "average_iops": avg, "interval_iops": measured, "bandwidth_mib_s": bw, "p50_latency_us": p50, "op_type": strings.TrimSpace(raw["OpType"]), "duration_seconds": numberOr(raw, []string{"StepDuration[s]"}, 0), "bytes_processed": optNumber(raw, "Size"), "concurrency": optNumber(raw, "Concurrency"), "concurrency_mean": optNumber(raw, "ConcurrencyMean"), "node_count": optNumber(raw, "NodeCount"), "corrupt_ops": optNumber(raw, "CountCorrupt"), "latency_mean_us": optNumber(raw, "LatencyAvg[us]"), "latency_min_us": optNumber(raw, "LatencyMin[us]"), "latency_max_us": optNumber(raw, "LatencyMax[us]"), "latency_p99_us": optNumber(raw, "LatencyQ_0.99[us]")})
	}
	return map[string]any{"run_id": runID, "workload_type": workload, "source_file": filepath.Base(path), "updated_at": info.ModTime().UTC().Format(time.RFC3339Nano), "is_active": active, "is_aggregate": aggregate, "samples": samples}, nil
}

func numberOr(row map[string]string, keys []string, def float64) float64 {
	if v, ok := parseNumber(row, keys...); ok {
		return v
	}
	return def
}

func parseTimestamp(v string) (time.Time, error) {
	v = strings.ReplaceAll(v, ",", ".")
	if t, e := time.Parse(time.RFC3339Nano, v); e == nil {
		return t, nil
	}
	for _, layout := range []string{"2006-01-02 15:04:05.999999999Z07:00", "2006-01-02 15:04:05.999999999", "2006-01-02T15:04:05.999999999"} {
		if t, e := time.Parse(layout, v); e == nil {
			return t, nil
		}
	}
	return time.Time{}, errors.New("bad timestamp")
}
