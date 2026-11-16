package server

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Expert runs may set the spt run flags below, and only these. The browser's
// flag schema (frontend/src/flags/schema.ts) offers the same flags, but this
// allow-list is the authority: anything else is rejected before SPT starts.
// Credentials, endpoints, buckets, hosts, paths, the image, engine overrides,
// ports, RDMA, NIC sets and --duration are never accepted.

type flagKind int

const (
	flagInt flagKind = iota
	flagFloat
	flagBool
	flagSize
	flagDuration
	flagEnum
	flagRegion
	flagHostname
)

type expertFlag struct {
	name string
	kind flagKind
	// Numeric range for flagInt and flagFloat.
	min, max float64
	// Choices for flagEnum.
	options []string
	// The value dashboard runs pass when the flag is not set; "" omits the
	// flag so SPT's own default applies. Bool flags use "true" or "false".
	dashboard string
}

var (
	cliSizePattern = regexp.MustCompile(`^([1-9][0-9]{0,8})(KiB|MiB|GiB|KB|MB|GB)$`)
	regionPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
	cliSizeShift   = map[string]uint{"KiB": 10, "MiB": 20, "GiB": 30, "KB": 10, "MB": 20, "GB": 30}
)

const maxFlagDuration = 5 * time.Minute

// writeVerifyFlags are the flags of `spt run write-verify` that expert runs may
// set, in the order they are passed to SPT.
var writeVerifyFlags = []expertFlag{
	{name: "object-data-compressibility", kind: flagFloat, min: 0, max: 100, dashboard: "0"},
	{name: "object-data-dedupable", kind: flagBool, dashboard: "true"},
	{name: "checksum", kind: flagEnum, options: []string{"crc32", "crc32c", "sha1", "sha256", "crc64-nvme"}},
	{name: "part-size", kind: flagSize},
	{name: "mpu-concurrent-objects", kind: flagInt, min: 0, max: 1024},
	{name: "mpu-concurrent-parts", kind: flagInt, min: 0, max: 1024},
	{name: "defer-verification", kind: flagBool},
	{name: "cleanup", kind: flagBool, dashboard: "true"},
	{name: "integrity-max-console-failures", kind: flagInt, min: 0, max: 10000},
	{name: "integrity-runtime-identity-tier", kind: flagEnum, options: []string{"image", "payload"}},
	{name: "prefix-shards", kind: flagInt, min: -1, max: 65536},
	{name: "s3-driver", kind: flagEnum, options: []string{"default", "aws"}, dashboard: "default"},
	{name: "auth-version", kind: flagEnum, options: []string{"2", "4"}, dashboard: "4"},
	{name: "region", kind: flagRegion},
	{name: "endpoint-selection", kind: flagEnum, options: []string{"default", "round-robin", "per-request-dns"}},
	{name: "endpoint-hostname", kind: flagHostname},
	{name: "dns-timeout", kind: flagDuration},
	{name: "endpoint-connect-timeout", kind: flagDuration},
	{name: "slice-endpoints", kind: flagBool},
	{name: "min-hosts", kind: flagInt, min: 0, max: maxHosts},
	{name: "service-threads", kind: flagInt, min: 1, max: 1024},
	{name: "save-items", kind: flagBool},
}

// writeFlags are the flags of `spt run write` that expert runs may set: the
// write-verify flags without the verification-only ones (defer-verification
// and the integrity flags), which spt run rejects for write.
var writeFlags = []expertFlag{
	{name: "object-data-compressibility", kind: flagFloat, min: 0, max: 100, dashboard: "0"},
	{name: "object-data-dedupable", kind: flagBool, dashboard: "true"},
	{name: "checksum", kind: flagEnum, options: []string{"crc32", "crc32c", "sha1", "sha256", "crc64-nvme"}},
	{name: "part-size", kind: flagSize},
	{name: "mpu-concurrent-objects", kind: flagInt, min: 0, max: 1024},
	{name: "mpu-concurrent-parts", kind: flagInt, min: 0, max: 1024},
	{name: "cleanup", kind: flagBool, dashboard: "true"},
	{name: "prefix-shards", kind: flagInt, min: -1, max: 65536},
	{name: "s3-driver", kind: flagEnum, options: []string{"default", "aws"}, dashboard: "default"},
	{name: "auth-version", kind: flagEnum, options: []string{"2", "4"}, dashboard: "4"},
	{name: "region", kind: flagRegion},
	{name: "endpoint-selection", kind: flagEnum, options: []string{"default", "round-robin", "per-request-dns"}},
	{name: "endpoint-hostname", kind: flagHostname},
	{name: "dns-timeout", kind: flagDuration},
	{name: "endpoint-connect-timeout", kind: flagDuration},
	{name: "slice-endpoints", kind: flagBool},
	{name: "min-hosts", kind: flagInt, min: 0, max: maxHosts},
	{name: "service-threads", kind: flagInt, min: 1, max: 1024},
	{name: "save-items", kind: flagBool},
}

// mockFlags are the flags of `spt run mock` that expert runs may set. Dashboard
// mock runs pass no --cleanup, so the delete phase is off unless set.
var mockFlags = []expertFlag{
	{name: "cleanup", kind: flagBool},
	{name: "min-hosts", kind: flagInt, min: 0, max: maxHosts},
	{name: "service-threads", kind: flagInt, min: 1, max: 1024},
}

// expertFlagsFor returns the flags a workload accepts, or nil when the
// workload takes no expert flags.
func expertFlagsFor(workload string) []expertFlag {
	switch workload {
	case driverWriteVerify:
		return writeVerifyFlags
	case workloadWrite:
		return writeFlags
	case driverMock:
		return mockFlags
	}
	return nil
}

func findExpertFlag(flags []expertFlag, name string) (expertFlag, bool) {
	for _, f := range flags {
		if f.name == name {
			return f, true
		}
	}
	return expertFlag{}, false
}

// flagText returns a validated flag value as SPT expects it on the command line.
func flagText(f expertFlag, value any) (string, error) {
	if f.kind == flagBool {
		b, ok := value.(bool)
		if !ok {
			return "", userErrorf("--%s must be true or false.", f.name)
		}
		return strconv.FormatBool(b), nil
	}
	s, ok := value.(string)
	if !ok {
		return "", userErrorf("--%s must be sent as text.", f.name)
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return "", userErrorf("--%s needs a value.", f.name)
	}
	switch f.kind {
	case flagInt:
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil || float64(n) < f.min || float64(n) > f.max {
			return "", userErrorf("--%s must be a whole number from %g to %g.", f.name, f.min, f.max)
		}
		return strconv.FormatInt(n, 10), nil
	case flagFloat:
		n, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(n) || n < f.min || n > f.max {
			return "", userErrorf("--%s must be a number from %g to %g.", f.name, f.min, f.max)
		}
		return strconv.FormatFloat(n, 'f', -1, 64), nil
	case flagSize:
		if _, ok := parseCLISize(s); !ok {
			return "", userErrorf("--%s must be a size such as 8MiB or 64MiB.", f.name)
		}
		return s, nil
	case flagDuration:
		d, err := time.ParseDuration(s)
		if err != nil || d <= 0 || d > maxFlagDuration {
			return "", userErrorf("--%s must be a duration from 1ms to 5m, such as 5s.", f.name)
		}
		return d.String(), nil
	case flagEnum:
		for _, o := range f.options {
			if s == o {
				return s, nil
			}
		}
		return "", userErrorf("--%s must be one of: %s.", f.name, strings.Join(f.options, ", "))
	case flagRegion:
		if !regionPattern.MatchString(s) {
			return "", userErrorf("--%s must use lowercase letters, digits and hyphens, e.g. us-east-1.", f.name)
		}
		return s, nil
	case flagHostname:
		if len(s) > 253 {
			return "", userErrorf("--%s must be a valid hostname.", f.name)
		}
		for _, label := range strings.Split(strings.TrimSuffix(s, "."), ".") {
			if !hostLabelPattern.MatchString(label) {
				return "", userErrorf("--%s must be a valid hostname.", f.name)
			}
		}
		return s, nil
	}
	return "", userErrorf("--%s is not supported.", f.name)
}

// parseCLISize reads a size as spt run accepts it; the legacy KB/MB/GB units
// are 1024-based aliases there.
func parseCLISize(value string) (int64, bool) {
	m := cliSizePattern.FindStringSubmatch(value)
	if m == nil {
		return 0, false
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return 0, false
	}
	return n << cliSizeShift[m[2]], true
}

// expertFlagValues validates an expert run's flags for its workload and returns
// each one as SPT expects it. It applies the same cross-flag rules as spt run.
func expertFlagValues(workload string, flags map[string]any, objectSize string) (map[string]string, error) {
	if len(flags) == 0 {
		return map[string]string{}, nil
	}
	allowed := expertFlagsFor(workload)
	if allowed == nil {
		return nil, userErrorf("Expert flags are not available for %s runs.", workload)
	}
	names := make([]string, 0, len(flags))
	for name := range flags {
		names = append(names, name)
	}
	sort.Strings(names) // a stable first error for the same request
	values := map[string]string{}
	for _, name := range names {
		f, ok := findExpertFlag(allowed, name)
		if !ok {
			return nil, userErrorf("--%s cannot be set for %s runs from the dashboard.", safeFlagName(name), workload)
		}
		text, err := flagText(f, flags[name])
		if err != nil {
			return nil, err
		}
		values[name] = text
	}
	return values, crossFlagRules(values, objectSize)
}

// crossFlagRules mirrors the rules that tie spt run flags together
// (cli/cmd/validation.go), so a run fails here with a clear message instead of
// inside SPT.
func crossFlagRules(v map[string]string, objectSize string) error {
	part, hasPart := v["part-size"]
	for _, name := range []string{"mpu-concurrent-objects", "mpu-concurrent-parts"} {
		if n, ok := v[name]; ok && n != "0" && !hasPart {
			return userErrorf("--%s needs --part-size.", name)
		}
	}
	if hasPart {
		partBytes, _ := parseCLISize(part)
		objectBytes, ok := parseSize(objectSize)
		if ok && partBytes >= objectBytes {
			return userError("--part-size must be smaller than the object size.")
		}
	}
	if v["defer-verification"] == "true" && v["cleanup"] != "false" {
		return userError("--defer-verification cannot be combined with cleanup. Turn cleanup off.")
	}
	mode := v["endpoint-selection"]
	if mode == "" {
		mode = "default"
	}
	if _, ok := v["endpoint-hostname"]; ok && mode != "round-robin" {
		return userError("--endpoint-hostname is only used with round-robin endpoint selection.")
	}
	if _, ok := v["dns-timeout"]; ok && mode != "per-request-dns" {
		return userError("--dns-timeout is only used with per-request DNS endpoint selection.")
	}
	if _, ok := v["endpoint-connect-timeout"]; ok && mode == "default" {
		return userError("--endpoint-connect-timeout is only used with round-robin or per-request DNS.")
	}
	if driver := v["s3-driver"]; mode != "default" && driver != "" && driver != "default" {
		return userError("Endpoint selection needs the default S3 driver.")
	}
	return nil
}

// expertArgs returns the workload's flag arguments for argv: every flag the
// dashboard always passes (with its expert value when one is set), then the
// other expert flags, in allow-list order. Values were validated by
// expertFlagValues, and each argument is one --name=value word.
func expertArgs(workload string, values map[string]string) []string {
	args := []string{}
	for _, f := range expertFlagsFor(workload) {
		if f.name == "service-threads" {
			continue // buildArgv always passes it; see serviceThreads
		}
		value, set := values[f.name]
		if !set {
			value = f.dashboard
		}
		if value != "" {
			args = append(args, "--"+f.name+"="+value)
		}
	}
	return args
}

// serviceThreads is the engine's carrier parallelism: the expert value when
// one is set, otherwise the run's thread count, as dashboard runs always used.
func serviceThreads(values map[string]string, threads int) string {
	if v, ok := values["service-threads"]; ok {
		return v
	}
	return strconv.Itoa(threads)
}

// safeFlagName keeps a rejected flag name printable and short in messages.
func safeFlagName(name string) string {
	if len(name) > 40 {
		name = name[:40]
	}
	quoted := strconv.QuoteToASCII(name)
	return quoted[1 : len(quoted)-1]
}
