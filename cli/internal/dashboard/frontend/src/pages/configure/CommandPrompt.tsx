import { Button, Code, Group, List, Modal, Text } from "@mantine/core";
import { defaults } from "../../config";
import { CommandError, parseSptCommand } from "../../flags/command";
import { findFlag, type FlagValue, type Workload } from "../../flags/schema";
import type { Options, RunLimits } from "../../types";
import { validateOptions } from "../../utils/validation";

export type CommandReview =
  | {
      kind: "apply";
      workload: Workload;
      options: Options;
      advanced: Record<string, FlagValue>;
      // The flags the command sets, as "--name value" for the prompt.
      settings: string[];
    }
  | { kind: "reject"; problems: string[] };

// Text that looks like an spt run command, e.g. "spt run mock …" or
// "./spt run write-verify …". Only such pastes open the prompt.
export function looksLikeSptCommand(text: string): boolean {
  return /^\s*(\S*[\\/])?spt(\.exe)?\s+run(\s|$)/.test(text);
}

export const workloadName = (w: Workload) =>
  w === "mock" ? "Mock driver" : "Write + verify";

// Reads a command into the full expert state it describes: settings the
// command leaves out return to their defaults, so the GUI matches it exactly.
export function reviewCommand(text: string, limits: RunLimits): CommandReview {
  try {
    const parsed = parseSptCommand(text);
    const options: Options = { ...defaults, ...parsed.core, mode: "expert" };
    const limitProblems = Object.values(validateOptions(options, limits));
    if (limitProblems.length)
      return { kind: "reject", problems: limitProblems };
    const settings = parsed.flags.map((name) => {
      const core = findFlag(parsed.workload, name)?.core;
      const value = core ? options[core] : parsed.advanced[name];
      return typeof value === "boolean"
        ? `--${name}${value ? "" : "=false"}`
        : `--${name} ${value}`;
    });
    return {
      kind: "apply",
      workload: parsed.workload,
      options,
      advanced: parsed.advanced,
      settings,
    };
  } catch (e) {
    return {
      kind: "reject",
      problems:
        e instanceof CommandError
          ? e.problems
          : ["The command could not be read."],
    };
  }
}

// Asks whether to apply a pasted or imported command. Mantine's Modal traps
// focus, and closes on Escape or a click outside.
export function CommandPrompt({
  review,
  currentWorkload,
  onApply,
  onClose,
}: {
  review: CommandReview | null;
  currentWorkload: Workload;
  onApply: () => void;
  onClose: () => void;
}) {
  const apply = review?.kind === "apply";
  return (
    <Modal
      opened={!!review}
      onClose={onClose}
      centered
      title={apply ? "Apply this command?" : "This command can't be applied"}
    >
      {review?.kind === "apply" && (
        <>
          <Text size="sm">
            Workload: <strong>{workloadName(review.workload)}</strong>
            {review.workload !== currentWorkload &&
              ` (switches from ${workloadName(currentWorkload)})`}
          </Text>
          {review.settings.length ? (
            <>
              <Text size="sm" mt="sm">
                Sets {review.settings.length} flag
                {review.settings.length === 1 ? "" : "s"}:
              </Text>
              <List size="sm" spacing={4} mt={4}>
                {review.settings.map((s) => (
                  <List.Item key={s}>
                    <Code>{s}</Code>
                  </List.Item>
                ))}
              </List>
            </>
          ) : (
            <Text size="sm" mt="sm">
              The command sets no flags.
            </Text>
          )}
          <Text size="xs" c="dimmed" mt="sm">
            Every setting not in the command returns to its default.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="filled" onClick={onApply} data-autofocus>
              Apply
            </Button>
          </Group>
        </>
      )}
      {review?.kind === "reject" && (
        <>
          <List size="sm" spacing={4}>
            {review.problems.map((p) => (
              <List.Item key={p}>{p}</List.Item>
            ))}
          </List>
          <Text size="xs" c="dimmed" mt="sm">
            Nothing was changed.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="filled" onClick={onClose} data-autofocus>
              OK
            </Button>
          </Group>
        </>
      )}
    </Modal>
  );
}
