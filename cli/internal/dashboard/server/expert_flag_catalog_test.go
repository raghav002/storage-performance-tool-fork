package server

import (
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
)

// The allow-lists built from expertflags/ must be exactly the lists the server
// accepted before the flags moved into shared files: names, order, ranges,
// choices and the values dashboard runs always pass.
func TestExpertFlagFilesBuildTheAllowLists(t *testing.T) {
	names := func(workload string) []string {
		out := []string{}
		for _, f := range expertFlagsFor(workload) {
			out = append(out, f.name)
		}
		return out
	}
	shared := []string{"object-data-compressibility", "object-data-dedupable", "checksum", "part-size", "mpu-concurrent-objects", "mpu-concurrent-parts"}
	rest := []string{"prefix-shards", "s3-driver", "auth-version", "region", "endpoint-selection", "endpoint-hostname", "dns-timeout", "endpoint-connect-timeout", "slice-endpoints", "min-hosts", "service-threads", "save-items"}
	join := func(parts ...[]string) []string {
		out := []string{}
		for _, p := range parts {
			out = append(out, p...)
		}
		return out
	}
	want := map[string][]string{
		driverWriteVerify: join(shared, []string{"defer-verification", "cleanup", "integrity-max-console-failures", "integrity-runtime-identity-tier"}, rest),
		workloadWrite:     join(shared, []string{"cleanup"}, rest),
		driverMock:        {"cleanup", "min-hosts", "service-threads"},
	}
	for workload, list := range want {
		if got := names(workload); !reflect.DeepEqual(got, list) {
			t.Errorf("%s allow-list:\n got  %v\n want %v", workload, got, list)
		}
	}
	if len(expertFlagLists) != len(want) {
		t.Errorf("loaded %d workloads; want write-verify, write and mock", len(expertFlagLists))
	}
	// Values dashboard runs pass even when the flag is unset.
	for workload, defaults := range map[string]map[string]string{
		driverWriteVerify: {"object-data-compressibility": "0", "object-data-dedupable": "true", "cleanup": "true", "s3-driver": "default", "auth-version": "4", "checksum": ""},
		workloadWrite:     {"cleanup": "true", "s3-driver": "default"},
		driverMock:        {"cleanup": "", "min-hosts": ""},
	} {
		for name, want := range defaults {
			f, ok := findExpertFlag(expertFlagsFor(workload), name)
			if !ok || f.dashboard != want {
				t.Errorf("%s --%s passes %q by default, want %q", workload, name, f.dashboard, want)
			}
		}
	}
	for name, r := range map[string][2]float64{
		"object-data-compressibility": {0, 100}, "mpu-concurrent-parts": {0, 1024}, "integrity-max-console-failures": {0, 10000},
		"prefix-shards": {-1, 65536}, "min-hosts": {0, maxHosts}, "service-threads": {1, 1024},
	} {
		f, _ := findExpertFlag(expertFlagsFor(driverWriteVerify), name)
		if f.min != r[0] || f.max != r[1] {
			t.Errorf("--%s range %g..%g, want %g..%g", name, f.min, f.max, r[0], r[1])
		}
	}
	region, _ := findExpertFlag(expertFlagsFor(workloadWrite), "region")
	hostname, _ := findExpertFlag(expertFlagsFor(workloadWrite), "endpoint-hostname")
	checksum, _ := findExpertFlag(expertFlagsFor(workloadWrite), "checksum")
	if region.kind != flagRegion || hostname.kind != flagHostname || !reflect.DeepEqual(checksum.options, []string{"crc32", "crc32c", "sha1", "sha256", "crc64-nvme"}) {
		t.Errorf("kinds or choices changed: region %v, hostname %v, checksum %v", region.kind, hostname.kind, checksum.options)
	}
}

func TestExpertFlagFilesRejectMistakes(t *testing.T) {
	const catalog = `{
	  "cleanup": {"kind": "bool", "label": "Clean up", "help": "Delete objects.", "default": true, "alwaysPass": true},
	  "min-hosts": {"kind": "int", "label": "Minimum", "help": "Wait for hosts.", "default": "0", "min": 0, "max": 8},
	  "checksum": {"kind": "enum", "label": "Checksum", "help": "Check uploads.", "default": "", "options": ["crc32"]}
	}`
	workload := func(flags string) string {
		return `{"workload": "mock", "groups": [{"id": "g", "title": "G", "purpose": "p", "flags": [` + flags + `]}]}`
	}
	load := func(files map[string]string) error {
		fsys := fstest.MapFS{}
		for name, body := range files {
			fsys["expertflags/"+name] = &fstest.MapFile{Data: []byte(body)}
		}
		_, err := loadExpertFlags(fsys)
		return err
	}
	if err := load(map[string]string{"flags.json": catalog, "mock.json": workload(`"cleanup", {"name": "min-hosts", "default": "1"}`)}); err != nil {
		t.Fatalf("valid files rejected: %v", err)
	}
	for name, tt := range map[string]struct{ catalog, file, fileName, want string }{
		"unknown flag":           {catalog, workload(`"nope"`), "mock.json", "not in flags.json"},
		"listed twice":           {catalog, workload(`"cleanup", "cleanup"`), "mock.json", "more than once"},
		"file name mismatch":     {catalog, workload(`"cleanup"`), "write.json", "must match"},
		"misspelt field":         {catalog, workload(`{"name": "cleanup", "lable": "x"}`), "mock.json", "unknown field"},
		"override without name":  {catalog, workload(`{"label": "x"}`), "mock.json", `needs a "name"`},
		"enum without options":   {strings.Replace(catalog, `, "options": ["crc32"]`, "", 1), workload(`"checksum"`), "mock.json", "needs options"},
		"number without range":   {strings.Replace(catalog, `, "min": 0, "max": 8`, "", 1), workload(`"min-hosts"`), "mock.json", "min <= max"},
		"alwaysPass, no default": {catalog, workload(`{"name": "checksum", "alwaysPass": true}`), "mock.json", "alwaysPass needs a default"},
		"bool default as text":   {catalog, workload(`{"name": "cleanup", "default": "true"}`), "mock.json", "must be true or false"},
		"unknown kind":           {strings.Replace(catalog, `"kind": "int"`, `"kind": "number"`, 1), workload(`"min-hosts"`), "mock.json", "unknown kind"},
		"empty section":          {catalog, `{"workload": "mock", "groups": [{"id": "g", "title": "G", "flags": []}]}`, "mock.json", "at least one flag"},
	} {
		err := load(map[string]string{"flags.json": tt.catalog, tt.fileName: tt.file})
		if err == nil || !strings.Contains(err.Error(), tt.want) {
			t.Errorf("%s: got %v, want an error containing %q", name, err, tt.want)
		}
	}
}
