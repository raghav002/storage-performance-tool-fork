# Expert flags

The `spt run` flags that Expert mode offers, one shared definition for the dashboard server and the browser:

- **The server** (`server/expert_flag_catalog.go`) embeds these files and builds each workload's allow-list from them. A run with any flag these files don't list is rejected before SPT starts.
- **The browser** (`frontend/src/flags/schema.ts`) shows the same flags, grouped the same way, with each flag's `help` text as its tooltip.

## Files

- **`flags.json`** defines every flag once, keyed by its `spt run` name (without `--`).
- **`<workload>.json`** (`write-verify.json`, `write.json`, `mock.json`) lists that workload's sections, in display order, and the flags in each.

## A flag in `flags.json`

| Field | Meaning |
|---|---|
| `kind` | `int`, `float`, `bool`, `size`, `duration`, `enum`, `region` or `hostname`. |
| `label` | The field's name in the GUI. |
| `help` | One or two sentences, shown as the tooltip. |
| `default` | The value dashboard runs use: `true`/`false` for `bool`, text otherwise. `""` means "leave the flag out; SPT's default applies". |
| `min`, `max` | Required for `int` and `float`. The server and the browser both enforce them. |
| `options` | Required for `enum`: the allowed values. |
| `alwaysPass` | `true` when dashboard runs pass the default even if nobody changes the flag. |
| `short` | The flag's one-letter form, if it has one (for pasted commands). |
| `core` | Set only on the four run settings (`object_count`, `object_size`, `threads`, `max_runtime_seconds`). They are validated by the server's run limits instead. |

## A workload file

```json
{
  "workload": "write",
  "groups": [
    { "id": "object-data", "title": "Object data", "purpose": "…", "flags": ["object-data-compressibility", "checksum"] },
    { "id": "cleanup", "title": "Cleanup", "purpose": "…",
      "flags": [{ "name": "cleanup", "label": "Clean up written objects", "help": "…" }] }
  ]
}
```

- **A flag entry** is a name from `flags.json`, or `{"name": …}` with only the fields that differ for this workload. For example, `cleanup` has a different label, tooltip and default in each workload.
- **The file name must match `workload`.**

## Adding a workload

1. Add `<workload>.json`, reusing flags from `flags.json` and adding any new ones there.
2. Teach the server to start that workload (`runWorkload` and `buildArgv` in `server/run.go`) and the browser to offer it (`Workload` in `frontend/src/flags/schema.ts`).
3. Run the tests. These catch mistakes in the files:
   - **Go:** `expert_flag_catalog_test.go` checks that every listed flag exists and that ranges, choices and defaults are well formed.
   - **Browser:** `flags/schema.test.ts` checks every flag is a real `spt run` flag and that each description is one or two sentences.
