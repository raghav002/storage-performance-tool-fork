package server

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"strconv"
	"strings"
)

// The expert flags live in expertflags/, shared with the browser
// (frontend/src/flags/schema.ts reads the same files):
//   - flags.json defines every flag once: its kind, range or choices, default,
//     label and tooltip text.
//   - <workload>.json lists the sections and flags that workload offers, in
//     order. An entry is a flag name, or {"name": …} with the fields that
//     differ for that workload (for example cleanup's label and default).
//
// The server builds each workload's allow-list from these files at startup.
// A malformed file stops the server here, so tests catch it, never a run.
//
//go:embed expertflags/*.json
var expertFlagFiles embed.FS

// catalogFlag is one flag as the JSON files describe it.
type catalogFlag struct {
	Kind  string `json:"kind"`
	Short string `json:"short"`
	// Core names the run request field a core setting fills; the server
	// validates those through its run limits, not this allow-list.
	Core    string   `json:"core"`
	Label   string   `json:"label"`
	Help    string   `json:"help"`
	Default any      `json:"default"`
	Min     *float64 `json:"min"`
	Max     *float64 `json:"max"`
	Options []string `json:"options"`
	// AlwaysPass: dashboard runs pass the default even when the flag is unset.
	AlwaysPass bool `json:"alwaysPass"`
}

type workloadSection struct {
	ID      string            `json:"id"`
	Title   string            `json:"title"`
	Purpose string            `json:"purpose"`
	Flags   []json.RawMessage `json:"flags"`
}

type workloadFile struct {
	Workload string            `json:"workload"`
	Groups   []workloadSection `json:"groups"`
}

var flagKinds = map[string]flagKind{
	"int": flagInt, "float": flagFloat, "bool": flagBool, "size": flagSize,
	"duration": flagDuration, "enum": flagEnum, "region": flagRegion, "hostname": flagHostname,
}

var coreFields = map[string]bool{"object_count": true, "object_size": true, "threads": true, "max_runtime_seconds": true}

// expertFlagLists holds each workload's allow-list, in the order its file
// lists the flags (the order they are passed to SPT).
var expertFlagLists = mustLoadExpertFlags(expertFlagFiles)

func mustLoadExpertFlags(files fs.FS) map[string][]expertFlag {
	lists, err := loadExpertFlags(files)
	if err != nil {
		panic("dashboard expert flag files: " + err.Error())
	}
	return lists
}

func loadExpertFlags(files fs.FS) (map[string][]expertFlag, error) {
	catalogRaw, err := fs.ReadFile(files, "expertflags/flags.json")
	if err != nil {
		return nil, err
	}
	catalog := map[string]json.RawMessage{}
	if err := strictJSON(catalogRaw, &catalog); err != nil {
		return nil, fmt.Errorf("flags.json: %w", err)
	}
	entries, err := fs.ReadDir(files, "expertflags")
	if err != nil {
		return nil, err
	}
	lists := map[string][]expertFlag{}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || name == "flags.json" || path.Ext(name) != ".json" {
			continue
		}
		raw, err := fs.ReadFile(files, "expertflags/"+name)
		if err != nil {
			return nil, err
		}
		var wf workloadFile
		if err := strictJSON(raw, &wf); err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		if wf.Workload+".json" != name {
			return nil, fmt.Errorf("%s: names workload %q; the file name must match", name, wf.Workload)
		}
		list, err := workloadAllowList(catalog, wf)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		lists[wf.Workload] = list
	}
	return lists, nil
}

// workloadAllowList resolves a workload file against the catalog: each entry's
// catalog definition, with the workload's own fields laid over it.
func workloadAllowList(catalog map[string]json.RawMessage, wf workloadFile) ([]expertFlag, error) {
	seen := map[string]bool{}
	list := []expertFlag{}
	for _, section := range wf.Groups {
		if section.ID == "" || section.Title == "" || len(section.Flags) == 0 {
			return nil, fmt.Errorf("section %q needs an id, a title and at least one flag", section.ID)
		}
		for _, rawEntry := range section.Flags {
			name, def, err := resolveFlag(catalog, rawEntry)
			if err != nil {
				return nil, err
			}
			if seen[name] {
				return nil, fmt.Errorf("--%s is listed more than once", name)
			}
			seen[name] = true
			flag, err := allowListFlag(name, def)
			if err != nil {
				return nil, fmt.Errorf("--%s: %w", name, err)
			}
			if def.Core == "" {
				list = append(list, flag)
			}
		}
	}
	return list, nil
}

// resolveFlag reads one workload entry: a flag name, or an object with the
// name and the fields to override.
func resolveFlag(catalog map[string]json.RawMessage, rawEntry json.RawMessage) (string, catalogFlag, error) {
	var name string
	override := map[string]json.RawMessage{}
	if err := json.Unmarshal(rawEntry, &name); err != nil {
		if err := json.Unmarshal(rawEntry, &override); err != nil {
			return "", catalogFlag{}, fmt.Errorf("a flag entry must be a name or an object: %s", rawEntry)
		}
		if err := json.Unmarshal(override["name"], &name); err != nil || name == "" {
			return "", catalogFlag{}, fmt.Errorf("an override needs a \"name\": %s", rawEntry)
		}
		delete(override, "name")
	}
	base, ok := catalog[name]
	if !ok {
		return "", catalogFlag{}, fmt.Errorf("--%s is not in flags.json", name)
	}
	merged := map[string]json.RawMessage{}
	if err := json.Unmarshal(base, &merged); err != nil {
		return "", catalogFlag{}, fmt.Errorf("--%s in flags.json: %w", name, err)
	}
	for k, v := range override {
		merged[k] = v
	}
	combined, err := json.Marshal(merged)
	if err != nil {
		return "", catalogFlag{}, err
	}
	var def catalogFlag
	if err := strictJSON(combined, &def); err != nil {
		return "", catalogFlag{}, fmt.Errorf("--%s: %w", name, err)
	}
	return name, def, nil
}

// allowListFlag checks a resolved definition and turns it into the server's form.
func allowListFlag(name string, def catalogFlag) (expertFlag, error) {
	kind, ok := flagKinds[def.Kind]
	if def.Core != "" && !coreFields[def.Core] {
		return expertFlag{}, fmt.Errorf("unknown core field %q", def.Core)
	}
	if !ok {
		return expertFlag{}, fmt.Errorf("unknown kind %q", def.Kind)
	}
	if def.Label == "" || def.Help == "" {
		return expertFlag{}, fmt.Errorf("needs a label and help text")
	}
	f := expertFlag{name: name, kind: kind, options: def.Options}
	switch kind {
	case flagInt, flagFloat:
		if def.Core == "" && (def.Min == nil || def.Max == nil || *def.Min > *def.Max) {
			return expertFlag{}, fmt.Errorf("a number flag needs min <= max")
		}
		if def.Min != nil {
			f.min = *def.Min
		}
		if def.Max != nil {
			f.max = *def.Max
		}
	case flagEnum:
		if len(def.Options) == 0 {
			return expertFlag{}, fmt.Errorf("an enum flag needs options")
		}
	}
	defaultText, err := defaultValueText(kind, def.Default)
	if err != nil {
		return expertFlag{}, err
	}
	if def.AlwaysPass {
		if defaultText == "" {
			return expertFlag{}, fmt.Errorf("alwaysPass needs a default to pass")
		}
		f.dashboard = defaultText
	}
	return f, nil
}

// defaultValueText is a default as SPT expects it on the command line.
func defaultValueText(kind flagKind, value any) (string, error) {
	switch v := value.(type) {
	case bool:
		if kind != flagBool {
			return "", fmt.Errorf("default %v is a boolean but the flag is not", v)
		}
		return strconv.FormatBool(v), nil
	case string:
		if kind == flagBool {
			return "", fmt.Errorf("a bool flag's default must be true or false")
		}
		return strings.TrimSpace(v), nil
	}
	return "", fmt.Errorf("default must be text, or true/false for a bool flag")
}

// strictJSON decodes one JSON value and rejects unknown fields, so a misspelt
// field name fails instead of being ignored.
func strictJSON(raw []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	return ensureEOF(dec)
}
