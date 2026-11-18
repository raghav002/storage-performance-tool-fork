package server

import (
	"encoding/json"
	"strings"
	"testing"
)

// expertRun is a valid expert write-verify request carrying flags.
func expertRun(flags map[string]any) options {
	return options{Mode: modeExpert, ObjectCount: 100, ObjectSize: "64MiB", Threads: 4, MaxRuntimeSeconds: 600, Flags: flags}
}

func TestExpertFlagsAcceptEveryWriteVerifyFlag(t *testing.T) {
	a := &app{}
	for name, flags := range map[string]map[string]any{
		"compressibility":   {"object-data-compressibility": "37.5"},
		"dedupable":         {"object-data-dedupable": false},
		"checksum":          {"checksum": "crc64-nvme"},
		"multipart":         {"part-size": "8MiB", "mpu-concurrent-objects": "4", "mpu-concurrent-parts": "16"},
		"legacy size unit":  {"part-size": "5MB"},
		"deferred":          {"defer-verification": true, "cleanup": false},
		"integrity":         {"integrity-max-console-failures": "0", "integrity-runtime-identity-tier": "payload"},
		"prefix shards":     {"prefix-shards": "-1"},
		"aws driver":        {"s3-driver": "aws", "region": "us-east-1"},
		"auth v2":           {"auth-version": "2"},
		"round robin":       {"endpoint-selection": "round-robin", "endpoint-hostname": "s3.lab.example", "endpoint-connect-timeout": "10s"},
		"per-request DNS":   {"endpoint-selection": "per-request-dns", "dns-timeout": "500ms"},
		"distribution":      {"slice-endpoints": true, "min-hosts": "1", "service-threads": "8"},
		"results":           {"save-items": true},
		"cleanup kept on":   {"cleanup": true},
		"no flags at all":   nil,
		"empty flags value": {},
	} {
		if err := a.validateOptions(expertRun(flags)); err != nil {
			t.Errorf("%s: rejected %v: %v", name, flags, err)
		}
	}
}

func TestExpertFlagsRejectAnythingElse(t *testing.T) {
	a := &app{}
	for name, flags := range map[string]map[string]any{
		"unknown flag":           {"nope": "1"},
		"credentials":            {"secret-key": "abc"},
		"endpoints":              {"endpoints": "https://elsewhere"},
		"image":                  {"spt-image": "evil:latest"},
		"engine override":        {"engine-override": "x=y"},
		"duration":               {"duration": "5m"},
		"results dir":            {"results-dir": "/tmp"},
		"deprecated":             {"create-prefix": true},
		"NIC set":                {"interfaces": "auto"},
		"bool as text":           {"cleanup": "false"},
		"text as bool":           {"checksum": true},
		"number as JSON number":  {"min-hosts": 1},
		"empty value":            {"object-data-compressibility": ""},
		"out of range":           {"object-data-compressibility": "101"},
		"negative count":         {"mpu-concurrent-parts": "-1"},
		"too many hosts":         {"min-hosts": "9"},
		"zero service threads":   {"service-threads": "0"},
		"not a number":           {"prefix-shards": "many"},
		"bad enum":               {"checksum": "md5"},
		"option-looking size":    {"part-size": "--cleanup"},
		"bad size":               {"part-size": "8 MiB"},
		"zero duration":          {"endpoint-selection": "per-request-dns", "dns-timeout": "0s"},
		"long duration":          {"endpoint-selection": "per-request-dns", "dns-timeout": "1h"},
		"option-looking region":  {"region": "-x"},
		"region with space":      {"region": "us east"},
		"hostname with argument": {"endpoint-selection": "round-robin", "endpoint-hostname": "a --cleanup"},
	} {
		if err := a.validateOptions(expertRun(flags)); err == nil {
			t.Errorf("%s: accepted %v", name, flags)
		}
	}
}

func TestExpertFlagsApplyCrossFlagRules(t *testing.T) {
	a := &app{}
	for name, tt := range map[string]struct {
		flags map[string]any
		want  string
	}{
		"multipart limit without part size": {map[string]any{"mpu-concurrent-parts": "4"}, "needs --part-size"},
		"part size not below object size":   {map[string]any{"part-size": "64MiB"}, "smaller than the object size"},
		"deferred with cleanup":             {map[string]any{"defer-verification": true}, "cannot be combined with cleanup"},
		"hostname without round robin":      {map[string]any{"endpoint-hostname": "s3.example"}, "round-robin"},
		"DNS timeout without per-request":   {map[string]any{"dns-timeout": "2s"}, "per-request DNS"},
		"connect timeout with default":      {map[string]any{"endpoint-connect-timeout": "2s"}, "round-robin or per-request DNS"},
		"selection with the aws driver":     {map[string]any{"endpoint-selection": "round-robin", "s3-driver": "aws"}, "default S3 driver"},
	} {
		err := a.validateOptions(expertRun(tt.flags))
		if err == nil || !strings.Contains(err.Error(), tt.want) {
			t.Errorf("%s: got %v, want an error containing %q", name, err, tt.want)
		}
	}
	// A multipart limit of 0 means unlimited, so it needs no part size.
	if err := a.validateOptions(expertRun(map[string]any{"mpu-concurrent-objects": "0"})); err != nil {
		t.Errorf("zero multipart limit: %v", err)
	}
}

func TestExpertFlagsOnlyInExpertRuns(t *testing.T) {
	a := &app{}
	guided := options{ObjectCount: 100, ObjectSize: "1MiB", Threads: 1, MaxRuntimeSeconds: 60, Flags: map[string]any{"cleanup": false}}
	if err := a.validateOptions(guided); err == nil || !strings.Contains(err.Error(), "expert mode") {
		t.Errorf("guided run with flags: %v", err)
	}
}

// mockRun is a valid expert mock request carrying flags.
func mockRun(flags map[string]any) options {
	o := expertRun(flags)
	o.Driver = driverMock
	return o
}

func TestExpertFlagsForMockRuns(t *testing.T) {
	a := &app{}
	for _, flags := range []map[string]any{
		{"cleanup": true},
		{"cleanup": false},
		{"min-hosts": "1", "service-threads": "8"},
	} {
		if err := a.validateOptions(mockRun(flags)); err != nil {
			t.Errorf("mock rejected %v: %v", flags, err)
		}
	}
	// Storage flags mean nothing to the mock driver, and blocked flags stay blocked.
	for _, flags := range []map[string]any{
		{"checksum": "crc32"},
		{"part-size": "8MiB"},
		{"s3-driver": "aws"},
		{"secret-key": "abc"},
		{"min-hosts": "9"},
		{"cleanup": "yes"},
	} {
		if err := a.validateOptions(mockRun(flags)); err == nil {
			t.Errorf("mock accepted %v", flags)
		}
	}
}

func TestBuildArgvAppliesMockFlags(t *testing.T) {
	a := &app{sptBin: "spt"}
	target := map[string]any{"hosts": []string{"10.0.0.1"}, "endpoint": "https://s3", "bucket": "b"}
	plain := argFlags(t, a.buildArgv("/r", "mt-dashboard-x", mockRun(nil), target))
	if _, ok := plain["--cleanup"]; ok {
		t.Errorf("a mock run without flags passed --cleanup: %v", plain)
	}
	if plain["--service-threads"] != "4" {
		t.Errorf("--service-threads = %q, want the thread count", plain["--service-threads"])
	}
	got := argFlags(t, a.buildArgv("/r", "mt-dashboard-x", mockRun(map[string]any{"cleanup": true, "min-hosts": "1", "service-threads": "8"}), target))
	for flag, want := range map[string]string{"--cleanup": "true", "--min-hosts": "1", "--service-threads": "8"} {
		if got[flag] != want {
			t.Errorf("%s = %q, want %q", flag, got[flag], want)
		}
	}
	for _, flag := range []string{"--endpoints", "--bucket", "--s3-driver", "--prefix"} {
		if _, ok := got[flag]; ok {
			t.Errorf("mock run passed storage flag %s", flag)
		}
	}
}

func TestExpertFlagsDecodeFromTheRunRequest(t *testing.T) {
	var o options
	body := `{"mode":"expert","object_count":100,"object_size":"64MiB","threads":4,"max_runtime_seconds":600,"flags":{"cleanup":false,"checksum":"crc32"}}`
	dec := json.NewDecoder(strings.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&o); err != nil {
		t.Fatal(err)
	}
	if o.Flags["cleanup"] != false || o.Flags["checksum"] != "crc32" {
		t.Fatalf("decoded flags: %#v", o.Flags)
	}
	if err := (&app{}).validateOptions(o); err != nil {
		t.Fatal(err)
	}
}

// argFlags maps each --name of an argv to its value, failing on a repeated flag.
func argFlags(t *testing.T, argv []string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for i := 3; i < len(argv); i++ {
		key, value, assigned := strings.Cut(argv[i], "=")
		if !strings.HasPrefix(key, "--") {
			t.Fatalf("unexpected argument %q in %v", argv[i], argv)
		}
		if _, dup := out[key]; dup {
			t.Fatalf("%s is passed twice: %v", key, argv)
		}
		if !assigned && key != "--headless" {
			i++
			value = argv[i]
		}
		out[key] = value
	}
	return out
}

func TestBuildArgvKeepsDashboardDefaultsWithoutFlags(t *testing.T) {
	a := &app{sptBin: "spt"}
	target := map[string]any{"hosts": []string{"10.0.0.1"}, "endpoint": "https://s3", "bucket": "b"}
	got := argFlags(t, a.buildArgv("/r", "mt-dashboard-x", options{ObjectCount: 10, ObjectSize: "64KiB", Threads: 3, MaxRuntimeSeconds: 60}, target))
	for flag, want := range map[string]string{
		"--s3-driver": "default", "--auth-version": "4", "--object-data-compressibility": "0",
		"--object-data-dedupable": "true", "--cleanup": "true", "--service-threads": "3",
	} {
		if got[flag] != want {
			t.Errorf("%s = %q, want %q", flag, got[flag], want)
		}
	}
	for _, flag := range []string{"--checksum", "--part-size", "--defer-verification", "--save-items"} {
		if _, ok := got[flag]; ok {
			t.Errorf("%s passed without being set", flag)
		}
	}
}

func TestBuildArgvAppliesExpertFlagsOnce(t *testing.T) {
	a := &app{sptBin: "spt"}
	target := map[string]any{"hosts": []string{"10.0.0.1"}, "endpoint": "https://s3", "bucket": "b"}
	o := expertRun(map[string]any{
		"cleanup": false, "defer-verification": true, "checksum": "crc32",
		"service-threads": "16", "object-data-compressibility": "50", "part-size": "8MiB",
	})
	argv := a.buildArgv("/r", "mt-dashboard-x", o, target)
	got := argFlags(t, argv)
	for flag, want := range map[string]string{
		"--cleanup": "false", "--defer-verification": "true", "--checksum": "crc32",
		"--service-threads": "16", "--object-data-compressibility": "50", "--part-size": "8MiB",
		"--s3-driver": "default", "--auth-version": "4", "--threads": "4",
	} {
		if got[flag] != want {
			t.Errorf("%s = %q, want %q", flag, got[flag], want)
		}
	}
	// The dashboard's own placement settings cannot be moved by a flag.
	if got["--prefix"] != "dashboard/mt-dashboard-x/" || got["--results-dir"] != "/r" || got["--bucket"] != "b" {
		t.Errorf("placement changed: %v", argv)
	}
}

func TestWriteWorkloadRequests(t *testing.T) {
	a := &app{}
	guided := options{ObjectCount: 100, ObjectSize: "1MiB", Threads: 1, MaxRuntimeSeconds: 60, Workload: workloadWrite}
	if err := a.validateOptions(guided); err != nil {
		t.Errorf("guided write run rejected: %v", err)
	}
	if got := runWorkload(guided); got != workloadWrite {
		t.Errorf("runWorkload = %q, want write", got)
	}
	for name, o := range map[string]options{
		"unknown workload":     {ObjectCount: 100, ObjectSize: "1MiB", Threads: 1, MaxRuntimeSeconds: 60, Workload: "delete"},
		"mock with a workload": {ObjectCount: 100, ObjectSize: "1MiB", Threads: 1, MaxRuntimeSeconds: 60, Driver: driverMock, Workload: workloadWrite},
	} {
		if err := a.validateOptions(o); err == nil {
			t.Errorf("%s: accepted %+v", name, o)
		}
	}
}

// writeRun is a valid expert write request carrying flags.
func writeRun(flags map[string]any) options {
	o := expertRun(flags)
	o.Workload = workloadWrite
	return o
}

func TestExpertFlagsForWriteRuns(t *testing.T) {
	a := &app{}
	for _, flags := range []map[string]any{
		nil,
		{"checksum": "crc32", "cleanup": false},
		{"part-size": "8MiB", "mpu-concurrent-parts": "4"},
		{"endpoint-selection": "round-robin", "endpoint-hostname": "s3.lab.example"},
		{"save-items": true, "min-hosts": "1", "service-threads": "8", "prefix-shards": "0"},
	} {
		if err := a.validateOptions(writeRun(flags)); err != nil {
			t.Errorf("write rejected %v: %v", flags, err)
		}
	}
	// spt run write rejects the verification-only flags, so the dashboard does too.
	for _, flags := range []map[string]any{
		{"defer-verification": true, "cleanup": false},
		{"integrity-max-console-failures": "5"},
		{"integrity-runtime-identity-tier": "payload"},
		{"secret-key": "abc"},
	} {
		if err := a.validateOptions(writeRun(flags)); err == nil {
			t.Errorf("write accepted %v", flags)
		}
	}
}

func TestBuildArgvAppliesWriteFlags(t *testing.T) {
	a := &app{sptBin: "spt"}
	target := map[string]any{"hosts": []string{"10.0.0.1"}, "endpoint": "https://s3", "bucket": "b"}
	got := argFlags(t, a.buildArgv("/r", "mt-dashboard-x", writeRun(map[string]any{"cleanup": false, "checksum": "sha256"}), target))
	for flag, want := range map[string]string{"--cleanup": "false", "--checksum": "sha256", "--s3-driver": "default"} {
		if got[flag] != want {
			t.Errorf("%s = %q, want %q", flag, got[flag], want)
		}
	}
}

func TestBuildArgvRunsTheWriteWorkload(t *testing.T) {
	a := &app{sptBin: "spt"}
	target := map[string]any{"hosts": []string{"10.0.0.1"}, "endpoint": "https://s3", "bucket": "b"}
	argv := a.buildArgv("/r", "mt-dashboard-x", options{ObjectCount: 10, ObjectSize: "64KiB", Threads: 2, MaxRuntimeSeconds: 60, Workload: workloadWrite}, target)
	if argv[1] != "run" || argv[2] != workloadWrite {
		t.Fatalf("wrong command: %v", argv)
	}
	got := argFlags(t, argv)
	// The same safe defaults as write-verify, cleanup included.
	for flag, want := range map[string]string{
		"--cleanup": "true", "--s3-driver": "default", "--auth-version": "4",
		"--object-data-compressibility": "0", "--object-data-dedupable": "true",
		"--prefix": "dashboard/mt-dashboard-x/", "--bucket": "b", "--service-threads": "2",
	} {
		if got[flag] != want {
			t.Errorf("%s = %q, want %q", flag, got[flag], want)
		}
	}
	for _, flag := range []string{"--defer-verification", "--integrity-max-console-failures", "--integrity-runtime-identity-tier"} {
		if _, ok := got[flag]; ok {
			t.Errorf("write run passed verification flag %s", flag)
		}
	}
}

func TestJobWorkloadNamesTheWriteWorkload(t *testing.T) {
	for want, opts := range map[string]any{
		workloadWrite:     map[string]any{"workload": "write"},
		driverWriteVerify: map[string]any{},
		driverMock:        map[string]any{"driver": "mock"},
	} {
		if got := jobWorkload(map[string]any{keyOptions: opts}); got != want {
			t.Errorf("jobWorkload(%v) = %q, want %q", opts, got, want)
		}
	}
	if got := jobWorkload(map[string]any{keyOptions: options{Workload: workloadWrite}}); got != workloadWrite {
		t.Errorf("jobWorkload(options) = %q, want write", got)
	}
}
