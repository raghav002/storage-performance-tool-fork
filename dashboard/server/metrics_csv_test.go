package server

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Missing P50 measurements must remain unknown, rather than becoming zero or
// borrowing the mean. SPT can report P50 in either of these two CSV columns.
func TestParseMetricsFileP50Latency(t *testing.T) {
	tests := []struct {
		name, median, quantile string
		want                   any
	}{
		{"median takes precedence", "42", "84", 42.0},
		{"empty median falls back to quantile", "", "84", 84.0},
		{"malformed median falls back to quantile", "invalid", "84", 84.0},
		{"NaN median falls back to quantile", "NaN", "84", 84.0},
		{"infinite median falls back to quantile", "+Inf", "84", 84.0},
		{"measured zero median is preserved", "0", "84", 0.0},
		{"measured zero quantile is preserved", "", "0", 0.0},
		{"empty measurements remain unknown", "", "", nil},
		{"malformed measurements remain unknown", "invalid", "invalid", nil},
		{"nonfinite measurements remain unknown", "NaN", "-Inf", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Keep the rest of the row valid so the test exercises latency parsing.
			// A different mean of 999 makes accidental mean-as-P50 substitution visible.
			header := []string{"DateTimeISO8601", "OpType", "CountSucc", "CountFail", "DurationSum[s]", "TPAvg[op/s]", "BWAvg[MiB/s]", "LatencyAvg[us]", "LatencyMed[us]", "LatencyQ_0.5[us]"}
			row := []string{"2026-10-22T12:00:00Z", "CREATE", "10", "0", "2", "5", "1", "999", tt.median, tt.quantile}
			var fixture strings.Builder
			writer := csv.NewWriter(&fixture)
			if err := writer.WriteAll([][]string{header, row}); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "create.metrics.csv")
			if err := os.WriteFile(path, []byte(fixture.String()), 0600); err != nil {
				t.Fatal(err)
			}

			// Exercise the real CSV parser; no SPT process or storage service is involved.
			a := &app{}
			metrics, err := a.parseMetricsFile(path, "test-run", "write-verify", false, false)
			if err != nil {
				t.Fatal(err)
			}
			samples, ok := metrics["samples"].([]map[string]any)
			if !ok || len(samples) != 1 {
				t.Fatalf("expected one valid sample, got %#v", metrics["samples"])
			}
			if got, exists := samples[0]["p50_latency_us"]; !exists || got != tt.want {
				t.Errorf("p50_latency_us = %#v (present: %v), want %#v", got, exists, tt.want)
			}
		})
	}
}
