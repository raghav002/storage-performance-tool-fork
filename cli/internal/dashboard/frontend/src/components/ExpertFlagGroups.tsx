import type { ReactNode } from "react";
import {
  flagGroups,
  type FlagDef,
  type FlagValue,
  type Workload,
} from "../flags/schema";
import type { FlagErrors } from "../flags/validate";

// Flags whose value differs from the dashboard default.
export function changedFlags(
  workload: Workload,
  values: Record<string, FlagValue>,
): FlagDef[] {
  return flagGroups[workload]
    .flatMap((g) => g.flags)
    .filter((f) => !f.core && (values[f.name] ?? f.default) !== f.default);
}

const emptyLabel: Record<string, string> = {
  checksum: "Off",
};

function FlagControl({
  id,
  flag,
  value,
  invalid,
  onChange,
}: {
  id: string;
  flag: FlagDef;
  value: FlagValue;
  invalid: boolean;
  onChange: (v: FlagValue) => void;
}) {
  const describedBy = `${id}-hint`;
  if (flag.kind === "bool")
    return (
      <span className="expert-toggle">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={value === true}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span aria-hidden="true">{value === true ? "On" : "Off"}</span>
      </span>
    );
  if (flag.kind === "enum")
    return (
      <select
        id={id}
        value={String(value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      >
        {flag.default === "" && (
          <option value="">{emptyLabel[flag.name] ?? "SPT default"}</option>
        )}
        {flag.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  const numeric = flag.kind === "int" || flag.kind === "float";
  const placeholder =
    flag.kind === "size"
      ? "e.g. 8MiB"
      : flag.kind === "duration"
        ? "e.g. 5s"
        : flag.default === ""
          ? "Default"
          : "";
  return (
    <input
      id={id}
      type="text"
      inputMode={
        numeric ? (flag.kind === "int" ? "numeric" : "decimal") : undefined
      }
      spellCheck={false}
      autoComplete="off"
      value={String(value)}
      placeholder={placeholder}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const defaultText = (f: FlagDef) =>
  typeof f.default === "boolean"
    ? f.default
      ? "On"
      : "Off"
    : f.default === ""
      ? (emptyLabel[f.name] ?? "SPT default")
      : f.default;

// Expert flags in one collapsible section per group. The first group holds
// the four settings the dashboard applies; `core` renders their fields.
export function ExpertFlagGroups({
  workload,
  core,
  coreChanged,
  values,
  errors,
  onChange,
}: {
  workload: Workload;
  core: ReactNode;
  coreChanged: number;
  values: Record<string, FlagValue>;
  errors: FlagErrors;
  onChange: (values: Record<string, FlagValue>) => void;
}) {
  const set = (name: string, value: FlagValue) =>
    onChange({ ...values, [name]: value });
  return (
    <div className="expert-groups">
      {flagGroups[workload].map((group, index) => {
        const isCore = group.flags.some((f) => f.core);
        const changed = isCore
          ? coreChanged
          : group.flags.filter(
              (f) => (values[f.name] ?? f.default) !== f.default,
            ).length;
        const invalid = group.flags.filter((f) => errors[f.name]).length;
        return (
          <div key={group.id}>
            {index === 1 && (
              <p className="expert-preview-banner" role="note">
                <strong>Preview only.</strong> The groups below are saved in
                profiles and shape the CLI preview, but this dashboard version
                runs only the four settings above.
              </p>
            )}
            <details
              className="expert-group"
              open={index === 0 ? true : undefined}
            >
              <summary>
                <span className="expert-group-heading">
                  <strong>{group.title}</strong>
                  <small>{group.purpose}</small>
                </span>
                <span className="expert-group-tags">
                  {invalid > 0 && (
                    <span className="expert-tag expert-tag-error">
                      {invalid} to fix
                    </span>
                  )}
                  {changed > 0 && (
                    <span className="expert-tag expert-tag-changed">
                      {changed} changed
                    </span>
                  )}
                  <span
                    className={`expert-tag ${isCore ? "expert-tag-applied" : "expert-tag-preview"}`}
                  >
                    {isCore ? "Applied to runs" : "Preview only"}
                  </span>
                </span>
              </summary>
              {isCore ? (
                <div className="expert-group-body">{core}</div>
              ) : (
                <div className="expert-group-body">
                  <div className="expert-flag-grid">
                    {group.flags.map((f) => {
                      const id = `flag-${workload}-${f.name}`;
                      const value = values[f.name] ?? f.default;
                      const modified = value !== f.default;
                      return (
                        <div
                          key={f.name}
                          className={`expert-flag ${modified ? "modified" : ""}`}
                        >
                          <label htmlFor={id}>
                            {f.label}
                            <code>--{f.name}</code>
                          </label>
                          <div className="expert-flag-control">
                            <FlagControl
                              id={id}
                              flag={f}
                              value={value}
                              invalid={!!errors[f.name]}
                              onChange={(v) => set(f.name, v)}
                            />
                            <button
                              type="button"
                              className="expert-flag-reset"
                              aria-label={`Reset ${f.label}`}
                              title={`Reset to ${defaultText(f)}`}
                              disabled={!modified}
                              onClick={() => set(f.name, f.default)}
                            >
                              ↺
                            </button>
                          </div>
                          {errors[f.name] ? (
                            <small
                              id={`${id}-hint`}
                              className="field-error"
                              role="alert"
                            >
                              {errors[f.name]}
                            </small>
                          ) : (
                            <small id={`${id}-hint`}>
                              {f.help} Default: {defaultText(f)}.
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {changed > 0 && (
                    <button
                      type="button"
                      className="expert-group-reset"
                      onClick={() =>
                        onChange({
                          ...values,
                          ...Object.fromEntries(
                            group.flags.map((f) => [f.name, f.default]),
                          ),
                        })
                      }
                    >
                      Reset group
                    </button>
                  )}
                </div>
              )}
            </details>
          </div>
        );
      })}
    </div>
  );
}
