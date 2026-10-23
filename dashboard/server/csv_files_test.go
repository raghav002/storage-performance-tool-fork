package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMetricsFilesSelection(t *testing.T) {
	type file struct {
		name  string
		order int // Explicit modification times avoid sleeps and filesystem ordering.
	}
	for _, tt := range []struct {
		name                      string
		files                     []file
		wantActive, wantCompleted string
		wantCompletedAggregate    bool
	}{
		{"empty directory", nil, "", "", false},
		{"unrelated files", []file{{"notes.csv", 1}, {"create.metrics.json", 2}}, "", "", false},
		{"interval only", []file{{"create.metrics.csv", 1}}, "create.metrics.csv", "create.metrics.csv", false},
		{"total only", []file{{"create.metrics.total.csv", 1}}, "", "create.metrics.total.csv", true},
		{"newer total cannot replace active interval", []file{{"create.metrics.csv", 1}, {"create.metrics.total.csv", 2}}, "create.metrics.csv", "create.metrics.total.csv", true},
		{"newer interval cannot replace completed total", []file{{"create.metrics.csv", 2}, {"create.metrics.total.csv", 1}}, "create.metrics.csv", "create.metrics.total.csv", true},
		{
			"create wins over newer phases",
			[]file{
				{"create.metrics.csv", 1}, {"read.metrics.csv", 2}, {"delete.metrics.csv", 3}, {"cleanup.metrics.csv", 4},
				{"create.metrics.total.csv", 1}, {"read.metrics.total.csv", 2}, {"delete.metrics.total.csv", 3}, {"cleanup.metrics.total.csv", 4},
			},
			"create.metrics.csv", "create.metrics.total.csv", true,
		},
		{
			"non-cleanup phase wins without create",
			[]file{
				{"read.metrics.csv", 1}, {"DELETE.metrics.csv", 2}, {"CLEANUP.metrics.csv", 3},
				{"read.metrics.total.csv", 1}, {"DELETE.metrics.total.csv", 2}, {"CLEANUP.metrics.total.csv", 3},
			},
			"read.metrics.csv", "read.metrics.total.csv", true,
		},
		{
			"newest create file wins",
			[]file{
				{"create-a.metrics.csv", 2}, {"create-z.metrics.csv", 1},
				{"create-a.metrics.total.csv", 2}, {"create-z.metrics.total.csv", 1},
			},
			"create-a.metrics.csv", "create-a.metrics.total.csv", true,
		},
		{
			"newest eligible phase wins without create",
			[]file{
				{"read.metrics.csv", 2}, {"verify.metrics.csv", 1},
				{"read.metrics.total.csv", 2}, {"verify.metrics.total.csv", 1},
			},
			"read.metrics.csv", "read.metrics.total.csv", true,
		},
		{
			"completed interval fallback still prefers create",
			[]file{{"create.metrics.csv", 1}, {"verify.metrics.csv", 2}, {"delete.metrics.csv", 3}},
			"create.metrics.csv", "create.metrics.csv", false,
		},
		{
			"cleanup-only data remains available as last resort",
			[]file{
				{"delete.metrics.csv", 1}, {"cleanup.metrics.csv", 2},
				{"delete.metrics.total.csv", 1}, {"cleanup.metrics.total.csv", 2},
			},
			"cleanup.metrics.csv", "cleanup.metrics.total.csv", true,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			// Even a directory whose name looks like CREATE metrics must be ignored.
			if err := os.Mkdir(filepath.Join(dir, "directory-create.metrics.csv"), 0700); err != nil {
				t.Fatal(err)
			}
			for _, f := range tt.files {
				path := filepath.Join(dir, f.name)
				if err := os.WriteFile(path, []byte("fixture\n"), 0600); err != nil {
					t.Fatal(err)
				}
				stamp := time.Date(2026, 10, 22, 12, f.order, 0, 0, time.UTC)
				if err := os.Chtimes(path, stamp, stamp); err != nil {
					t.Fatal(err)
				}
			}
			for _, mode := range []struct {
				name              string
				active, aggregate bool
				want              string
			}{
				{"active", true, false, tt.wantActive},
				{"completed", false, tt.wantCompletedAggregate, tt.wantCompleted},
			} {
				t.Run(mode.name, func(t *testing.T) {
					a := &app{}
					path, aggregate := a.metricsFiles(dir, mode.active)
					want := ""
					if mode.want != "" {
						want = filepath.Join(dir, mode.want)
					}
					if path != want || aggregate != mode.aggregate {
						t.Errorf("metricsFiles = (%q, %v), want (%q, %v)", path, aggregate, want, mode.aggregate)
					}
				})
			}
		})
	}
}

func TestMetricsFileSelectionControlsRates(t *testing.T) {
	dir := t.TempDir()
	for name, contents := range map[string]string{
		"create.metrics.csv": parsingCSVHeader + parsingCSVFirst,
		"create.metrics.total.csv": parsingCSVHeader +
			"2026-10-22T12:00:20Z,CREATE,100,3,20,5,0,7.5,0,20,10485760,1,4\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, tt := range []struct {
		name              string
		active, aggregate bool
		file              string
		iops, bw, elapsed float64
	}{
		{"active", true, false, "create.metrics.csv", 8, 2.5, 0},
		{"completed", false, true, "create.metrics.total.csv", 5, 7.5, 20},
	} {
		t.Run(tt.name, func(t *testing.T) {
			a := &app{}
			path, aggregate := a.metricsFiles(dir, tt.active)
			if path != filepath.Join(dir, tt.file) || aggregate != tt.aggregate {
				t.Fatalf("wrong source or mode: %q, aggregate %v", path, aggregate)
			}
			metrics, err := a.parseMetricsFile(path, "test-run", "write-verify", tt.active, aggregate)
			if err != nil {
				t.Fatal(err)
			}
			for key, want := range map[string]any{"source_file": tt.file, "is_active": tt.active, "is_aggregate": tt.aggregate} {
				if got := metrics[key]; got != want {
					t.Errorf("%s = %#v, want %#v", key, got, want)
				}
			}
			samples, ok := metrics["samples"].([]map[string]any)
			if !ok || len(samples) != 1 {
				t.Fatalf("expected one sample from selected file, got %#v", metrics["samples"])
			}
			for key, want := range map[string]float64{"interval_iops": tt.iops, "bandwidth_mib_s": tt.bw, "elapsed_seconds": tt.elapsed} {
				if got := samples[0][key]; got != want {
					t.Errorf("%s = %#v, want %v", key, got, want)
				}
			}
		})
	}
}
