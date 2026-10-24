package server

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

const parsingCSVHeader = "DateTimeISO8601,OpType,CountSucc,CountFail,DurationSum[s],TPAvg[op/s],TPLast[op/s],BWAvg[MiB/s],BWLast[MiB/s],StepDuration[s],Size,NodeCount,Concurrency\n"
const parsingCSVFirst = "2026-10-22T07:00:00-05:00, CREATE ,10,1,2,5,8,1.5,2.5,2,1048576,1,4\n"
const parsingCSVSecond = "2026-10-22T12:00:10Z,VERIFY,30,2,6,10,12,3.5,4.5,6,3145728,2,8\n"

func writeParsingCSV(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "create.metrics.csv")
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestParseMetricsFileSkipsBadRows(t *testing.T) {
	for _, tt := range []struct{ name, badRow string }{
		{"invalid timestamp", "not-a-timestamp,CREATE,20,0,4,7,9,2,3,4\n"},
		{"malformed CSV", "2026-10-22T12:00:05Z,CRE\"ATE,20,0,4,7,9,2,3,4\n"},
		{"idle row", "2026-10-22T12:00:05Z,CREATE,0,0,0,99,99,99,99,4\n"},
		{"short required fields", "2026-10-22T12:00:05Z,CREATE,20,0,4,7,9\n"},
		{"invalid average IOPS", "2026-10-22T12:00:05Z,CREATE,20,0,4,invalid,9,2,3,4\n"},
		{"invalid bandwidth", "2026-10-22T12:00:05Z,CREATE,20,0,4,7,9,invalid,invalid,4\n"},
		{"blank line", "\n"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			// An invalid leading timestamp must not establish the elapsed-time origin.
			leading := "invalid-date,CREATE,1,0,1,1,1,1,1,1\n"
			path := writeParsingCSV(t, parsingCSVHeader+leading+parsingCSVFirst+tt.badRow+parsingCSVSecond)
			for _, mode := range []struct {
				name      string
				aggregate bool
				iops, bw  [2]float64
				elapsed   [2]float64
			}{
				{"interval", false, [2]float64{8, 12}, [2]float64{2.5, 4.5}, [2]float64{0, 10}},
				{"aggregate", true, [2]float64{5, 10}, [2]float64{1.5, 3.5}, [2]float64{2, 6}},
			} {
				t.Run(mode.name, func(t *testing.T) {
					a := &app{}
					metrics, err := a.parseMetricsFile(path, "test-run", "write-verify", !mode.aggregate, mode.aggregate)
					if err != nil {
						t.Fatal(err)
					}
					samples, ok := metrics["samples"].([]map[string]any)
					if !ok || len(samples) != 2 {
						t.Fatalf("expected both valid neighbors in order, got %#v", metrics["samples"])
					}
					want := []map[string]any{
						{"timestamp": "2026-10-22T12:00:00Z", "op_type": "CREATE", "cumulative_ops": 10.0, "count_failed": 1.0, "average_iops": 5.0, "bytes_processed": 1048576.0, "node_count": 1.0, "concurrency": 4.0, "duration_seconds": 2.0},
						{"timestamp": "2026-10-22T12:00:10Z", "op_type": "VERIFY", "cumulative_ops": 30.0, "count_failed": 2.0, "average_iops": 10.0, "bytes_processed": 3145728.0, "node_count": 2.0, "concurrency": 8.0, "duration_seconds": 6.0},
					}
					for i := range samples {
						want[i]["interval_iops"] = mode.iops[i]
						want[i]["bandwidth_mib_s"] = mode.bw[i]
						want[i]["elapsed_seconds"] = mode.elapsed[i]
						for key, value := range want[i] {
							if got := samples[i][key]; got != value {
								t.Errorf("sample %d %s = %#v, want %#v", i, key, got, value)
							}
						}
					}
				})
			}
		})
	}
}

func TestParseMetricsFileShortOptionalRows(t *testing.T) {
	// The first row omits only optional columns; the second also omits BWLast,
	// which must fall back to BWAvg instead of discarding the whole row.
	contents := parsingCSVHeader +
		"2026-10-22T12:00:00Z,CREATE,10,0,2,5,8,1.5,2.5\n" +
		"2026-10-22T12:00:02Z,CREATE,20,0,4,5,9,3.5\n"
	path := writeParsingCSV(t, contents)
	for _, mode := range []struct {
		name      string
		aggregate bool
		iops, bw  [2]float64
	}{
		{"interval", false, [2]float64{8, 9}, [2]float64{2.5, 3.5}},
		{"aggregate", true, [2]float64{5, 5}, [2]float64{1.5, 3.5}},
	} {
		t.Run(mode.name, func(t *testing.T) {
			a := &app{}
			metrics, err := a.parseMetricsFile(path, "test-run", "write-verify", false, mode.aggregate)
			if err != nil {
				t.Fatal(err)
			}
			samples, ok := metrics["samples"].([]map[string]any)
			if !ok || len(samples) != 2 {
				t.Fatalf("expected two short but usable rows, got %#v", metrics["samples"])
			}
			for i, sample := range samples {
				if sample["interval_iops"] != mode.iops[i] || sample["bandwidth_mib_s"] != mode.bw[i] {
					t.Errorf("sample %d has wrong rates: %#v", i, sample)
				}
				for _, key := range []string{"bytes_processed", "node_count", "concurrency"} {
					if got, exists := sample[key]; !exists || got != nil {
						t.Errorf("sample %d %s = %#v (present: %v), want unknown", i, key, got, exists)
					}
				}
			}
		})
	}
}

func TestParseMetricsFileGrowingCSV(t *testing.T) {
	// Model two polls while SPT is still appending its last CSV record.
	path := writeParsingCSV(t, parsingCSVHeader+parsingCSVFirst+"2026-10-22T12:00:10Z,VERIFY,30,2,6")
	a := &app{}
	before, err := a.parseMetricsFile(path, "test-run", "write-verify", true, false)
	if err != nil {
		t.Fatal(err)
	}
	first, ok := before["samples"].([]map[string]any)
	if !ok || len(first) != 1 || first[0]["interval_iops"] != 8.0 {
		t.Fatalf("incomplete trailing row damaged the completed sample: %#v", before["samples"])
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, writeErr := f.WriteString(",10,12,3.5,4.5,6,3145728,2,8\n")
	closeErr := f.Close()
	if writeErr != nil || closeErr != nil {
		t.Fatalf("append record: write %v, close %v", writeErr, closeErr)
	}
	after, err := a.parseMetricsFile(path, "test-run", "write-verify", true, false)
	if err != nil {
		t.Fatal(err)
	}
	samples, ok := after["samples"].([]map[string]any)
	if !ok || len(samples) != 2 {
		t.Fatalf("completed trailing row was not recovered: %#v", after["samples"])
	}
	for key, value := range first[0] {
		if samples[0][key] != value {
			t.Errorf("previous sample %s changed: %#v, want %#v", key, samples[0][key], value)
		}
	}
	for key, value := range map[string]any{"timestamp": "2026-10-22T12:00:10Z", "elapsed_seconds": 10.0, "op_type": "VERIFY", "cumulative_ops": 30.0, "interval_iops": 12.0, "bandwidth_mib_s": 4.5} {
		if got := samples[1][key]; got != value {
			t.Errorf("recovered sample %s = %#v, want %#v", key, got, value)
		}
	}
}

func TestParseMetricsFileEmptyInput(t *testing.T) {
	for _, tt := range []struct {
		name, contents string
		wantErr        error
	}{
		{"empty file", "", io.EOF},
		{"header only", parsingCSVHeader, nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			a := &app{}
			metrics, err := a.parseMetricsFile(writeParsingCSV(t, tt.contents), "test-run", "write-verify", true, false)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr == nil {
				samples, ok := metrics["samples"].([]map[string]any)
				if !ok || len(samples) != 0 {
					t.Fatalf("header-only file must not manufacture samples: %#v", metrics["samples"])
				}
			}
		})
	}
}
