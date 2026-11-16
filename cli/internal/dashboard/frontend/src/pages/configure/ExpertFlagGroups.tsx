import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  NativeSelect,
  Switch,
  TextInput,
} from "@mantine/core";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import {
  flagGroups,
  type FlagDef,
  type FlagValue,
  type GroupDef,
  type Workload,
} from "../../flags/schema";
import type { FlagErrors } from "../../flags/validate";
import { FlagHelp } from "./FlagHelp";

// What an empty default means for flags that show it differently.
const emptyLabel: Record<string, string> = { checksum: "Off" };

// The default as shown to users: "On"/"Off", or what an empty value means.
export const defaultText = (f: FlagDef) =>
  typeof f.default === "boolean"
    ? f.default
      ? "On"
      : "Off"
    : f.default === ""
      ? (emptyLabel[f.name] ?? "SPT default")
      : f.default;

function FlagLabel({ flag }: { flag: FlagDef }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-xs">
      <FlagHelp help={flag.help}>{flag.label}</FlagHelp>
      <Code fz="xs">--{flag.name}</Code>
    </span>
  );
}

function FlagControl({
  workload,
  flag,
  value,
  error,
  onChange,
}: {
  workload: Workload;
  flag: FlagDef;
  value: FlagValue;
  error?: string;
  onChange: (v: FlagValue) => void;
}) {
  const id = `flag-${workload}-${flag.name}`;
  const common = {
    id,
    label: <FlagLabel flag={flag} />,
    "aria-description": flag.help,
    description: error ? undefined : `Default: ${defaultText(flag)}`,
    error,
  };
  if (flag.kind === "bool")
    return (
      <Switch
        {...common}
        checked={value === true}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    );
  if (flag.kind === "enum")
    return (
      <NativeSelect
        {...common}
        value={String(value)}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {flag.default === "" && (
          <option value="">{emptyLabel[flag.name] ?? "SPT default"}</option>
        )}
        {flag.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </NativeSelect>
    );
  const numeric = flag.kind === "int" || flag.kind === "float";
  return (
    <TextInput
      {...common}
      // Text, not type="number": validation sees exactly what will be written
      // into the command, and inputMode still brings up a numeric keypad.
      inputMode={
        numeric ? (flag.kind === "int" ? "numeric" : "decimal") : undefined
      }
      spellCheck={false}
      autoComplete="off"
      value={String(value)}
      placeholder={
        flag.kind === "size"
          ? "e.g. 8MiB"
          : flag.kind === "duration"
            ? "e.g. 5s"
            : flag.default === ""
              ? "Default"
              : undefined
      }
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

function GroupItem({
  workload,
  group,
  applied,
  changed,
  invalid,
  children,
}: {
  workload: Workload;
  group: GroupDef;
  applied: boolean;
  changed: number;
  invalid: number;
  children: ReactNode;
}) {
  return (
    <Accordion.Item value={group.id}>
      <Accordion.Control aria-label={group.title}>
        <span className="flex flex-wrap items-center justify-between gap-xs">
          <span className="flex flex-col min-w-0">
            <strong className="text-sm/[inherit] text-foreground">
              {group.title}
            </strong>
            <span className="text-caption/[inherit] text-muted">
              {group.purpose}
            </span>
          </span>
          <span
            className="flex flex-wrap gap-1.25"
            data-testid={`tags-${workload}-${group.id}`}
          >
            {invalid > 0 && (
              <Badge color="red" variant="light">
                {invalid} to fix
              </Badge>
            )}
            {changed > 0 && (
              <Badge color="blue" variant="light">
                {changed} changed
              </Badge>
            )}
            <Badge color={applied ? "green" : "gray"} variant="light">
              {applied ? "Applied to runs" : "Preview only"}
            </Badge>
          </span>
        </span>
      </Accordion.Control>
      <Accordion.Panel>{children}</Accordion.Panel>
    </Accordion.Item>
  );
}

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
  const [first, ...rest] = flagGroups[workload];
  const set = (name: string, value: FlagValue) =>
    onChange({ ...values, [name]: value });
  const changedIn = (g: GroupDef) =>
    g.flags.filter((f) => (values[f.name] ?? f.default) !== f.default);
  return (
    <div className="mt-3.75 mb-lg flex flex-col gap-sm">
      <Accordion multiple variant="separated" defaultValue={[first.id]}>
        <GroupItem
          workload={workload}
          group={first}
          applied
          changed={coreChanged}
          invalid={0}
        >
          {core}
        </GroupItem>
      </Accordion>
      <Alert role="note" title="Preview only">
        The groups below shape the CLI preview, but this dashboard version runs
        only the four settings above.
      </Alert>
      <Accordion multiple variant="separated">
        {rest.map((group) => {
          const changed = changedIn(group);
          return (
            <GroupItem
              key={group.id}
              workload={workload}
              group={group}
              applied={false}
              changed={changed.length}
              invalid={group.flags.filter((f) => errors[f.name]).length}
            >
              <div className="grid grid-cols-2 gap-3.75 max-[47.5rem]:grid-cols-1">
                {group.flags.map((f) => {
                  const value = values[f.name] ?? f.default;
                  const modified = value !== f.default;
                  return (
                    <div
                      key={f.name}
                      className="flex items-start gap-xs min-w-0"
                    >
                      <div className="flex-1 min-w-0">
                        <FlagControl
                          workload={workload}
                          flag={f}
                          value={value}
                          error={errors[f.name]}
                          onChange={(v) => set(f.name, v)}
                        />
                      </div>
                      <ActionIcon
                        variant="subtle"
                        mt="lg"
                        aria-label={`Reset ${f.label}`}
                        disabled={!modified}
                        onClick={() => set(f.name, f.default)}
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                      </ActionIcon>
                    </div>
                  );
                })}
              </div>
              {changed.length > 0 && (
                <Button
                  variant="subtle"
                  size="xs"
                  mt="sm"
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
                </Button>
              )}
            </GroupItem>
          );
        })}
      </Accordion>
    </div>
  );
}
