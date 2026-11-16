import { Input, NativeSelect, TextInput } from "@mantine/core";
import type { State } from "../../types";
import {
  formatBytes,
  sizeUnits,
  type OptionErrors,
  type SizeUnit,
} from "../../utils/validation";
import type { ExpertDraft } from "./configuration";

export function ExpertFields({
  draft,
  setDraft,
  errors,
  limits,
}: {
  draft: ExpertDraft;
  setDraft: (d: ExpertDraft) => void;
  errors: OptionErrors;
  limits: NonNullable<State["limits"]>;
}) {
  const e = limits.expert;
  const number = (
    key: "object_count" | "threads" | "max_runtime_seconds",
    label: string,
    range: { min: number; max: number },
    hint: string,
  ) => (
    <TextInput
      label={label}
      type="number"
      inputMode="numeric"
      min={range.min}
      max={range.max}
      step={1}
      value={draft[key]}
      error={errors[key]}
      description={!errors[key] ? hint : undefined}
      onChange={(ev) => setDraft({ ...draft, [key]: ev.target.value })}
    />
  );
  return (
    <div className="mt-3.75 mb-lg grid grid-cols-2 gap-3.75 max-[47.5rem]:grid-cols-1">
      {number(
        "object_count",
        "Maximum objects",
        e.object_count,
        `${e.object_count.min}–${e.object_count.max.toLocaleString("en-US")} objects.`,
      )}
      <Input.Wrapper
        id="expert-object-size-amount"
        label="Object size"
        error={errors.object_size}
        description={
          !errors.object_size
            ? `${formatBytes(e.object_size_bytes.min)}–${formatBytes(e.object_size_bytes.max)} per object.`
            : undefined
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-xs">
          <Input
            id="expert-object-size-amount"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={draft.size_amount}
            aria-label="Object size amount"
            error={!!errors.object_size}
            onChange={(ev) =>
              setDraft({ ...draft, size_amount: ev.target.value })
            }
          />
          <NativeSelect
            aria-label="Object size unit"
            value={draft.size_unit}
            onChange={(ev) =>
              setDraft({ ...draft, size_unit: ev.target.value as SizeUnit })
            }
            data={Object.keys(sizeUnits)}
          />
        </div>
      </Input.Wrapper>
      {number(
        "threads",
        "Parallel threads",
        e.threads,
        `${e.threads.min}–${e.threads.max} concurrent requests per client machine.`,
      )}
      {number(
        "max_runtime_seconds",
        "Safety time limit (seconds)",
        e.max_runtime_seconds,
        `${e.max_runtime_seconds.min}–${e.max_runtime_seconds.max} seconds.`,
      )}
    </div>
  );
}
