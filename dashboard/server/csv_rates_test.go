package server

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseMetricsFileRates(t *testing.T) {
	for _, metric := range []struct {
		name, averageColumn, lastColumn, outputKey string
		intervalWithoutAverage                     any
	}{
		// CSV rows require average IOPS, even when last IOPS is valid.
		{"IOPS", "TPAvg[op/s]", "TPLast[op/s]", "interval_iops", nil},
		{"bandwidth", "BWAvg[MiB/s]", "BWLast[MiB/s]", "bandwidth_mib_s", 8.25},
	} {
		t.Run(metric.name, func(t *testing.T) {
			for _, tt := range []struct {
				name, average, last       string
				omitAverage, omitLast     bool
				wantInterval, wantAverage any // nil means the row must be skipped.
			}{
				{"last takes precedence", "5.5", "8.25", false, false, 8.25, 5.5},
				{"missing last column falls back", "5.5", "", false, true, 5.5, 5.5},
				{"empty last falls back", "5.5", "", false, false, 5.5, 5.5},
				{"malformed last falls back", "5.5", "invalid", false, false, 5.5, 5.5},
				{"NaN last falls back", "5.5", "NaN", false, false, 5.5, 5.5},
				{"positive infinite last falls back", "5.5", "+Inf", false, false, 5.5, 5.5},
				{"negative infinite last falls back", "5.5", "-Inf", false, false, 5.5, 5.5},
				{"measured zero last is preserved", "5.5", "0", false, false, 0.0, 5.5},
				{"measured zero average is preserved", "0", "8.25", false, false, 8.25, 0.0},
				{"fallback preserves zero average", "0", "", false, true, 0.0, 0.0},
				{"missing average with valid last", "", "8.25", true, false, metric.intervalWithoutAverage, nil},
				{"empty average with valid last", "", "8.25", false, false, metric.intervalWithoutAverage, nil},
				{"malformed average with valid last", "invalid", "8.25", false, false, metric.intervalWithoutAverage, nil},
				{"NaN average with valid last", "NaN", "8.25", false, false, metric.intervalWithoutAverage, nil},
				{"infinite average with valid last", "+Inf", "8.25", false, false, metric.intervalWithoutAverage, nil},
				{"missing rate columns skip row", "", "", true, true, nil, nil},
				{"empty rates skip row", "", "", false, false, nil, nil},
				{"malformed rates skip row", "invalid", "invalid", false, false, nil, nil},
				{"nonfinite rates skip row", "NaN", "-Inf", false, false, nil, nil},
			} {
				t.Run(tt.name, func(t *testing.T) {
					// Positive activity prevents idle-row filtering from masking rate behavior.
					// Keep the other metric valid and distinct to catch column mix-ups.
					columns := [][2]string{
						{"DateTimeISO8601", "2026-10-22T12:00:00Z"},
						{"OpType", "CREATE"}, {"CountSucc", "10"}, {"DurationSum[s]", "2"},
						{"TPAvg[op/s]", "17"}, {"TPLast[op/s]", "23"},
						{"BWAvg[MiB/s]", "17"}, {"BWLast[MiB/s]", "23"},
					}
					var header, row []string
					for _, column := range columns {
						switch column[0] {
						case metric.averageColumn:
							if tt.omitAverage {
								continue
							}
							column[1] = tt.average
						case metric.lastColumn:
							if tt.omitLast {
								continue
							}
							column[1] = tt.last
						}
						header = append(header, column[0])
						row = append(row, column[1])
					}
					var fixture strings.Builder
					if err := csv.NewWriter(&fixture).WriteAll([][]string{header, row}); err != nil {
						t.Fatal(err)
					}
					path := filepath.Join(t.TempDir(), "create.metrics.csv")
					if err := os.WriteFile(path, []byte(fixture.String()), 0600); err != nil {
						t.Fatal(err)
					}
					for _, mode := range []struct {
						name      string
						aggregate bool
						want      any
					}{{"interval", false, tt.wantInterval}, {"aggregate", true, tt.wantAverage}} {
						t.Run(mode.name, func(t *testing.T) {
							a := &app{}
							metrics, err := a.parseMetricsFile(path, "test-run", "write-verify", false, mode.aggregate)
							if err != nil {
								t.Fatal(err)
							}
							samples, ok := metrics["samples"].([]map[string]any)
							if !ok {
								t.Fatalf("unexpected samples type: %T", metrics["samples"])
							}
							if mode.want == nil {
								if len(samples) != 0 {
									t.Fatalf("unavailable required rate must skip row, got %#v", samples)
								}
								return
							}
							if len(samples) != 1 {
								t.Fatalf("expected one valid sample, got %#v", samples)
							}
							if got := samples[0][metric.outputKey]; got != mode.want {
								t.Errorf("%s = %#v, want %#v", metric.outputKey, got, mode.want)
							}
							if metric.name == "IOPS" && samples[0]["average_iops"] != tt.wantAverage {
								t.Errorf("average_iops = %#v, want %#v", samples[0]["average_iops"], tt.wantAverage)
							}
						})
					}
				})
			}
		})
	}
}
