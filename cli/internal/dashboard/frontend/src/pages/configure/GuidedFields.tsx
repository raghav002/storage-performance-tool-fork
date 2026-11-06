import { NativeSelect } from "@mantine/core";
import type { Options, State } from "../../types";
import type { OptionErrors } from "../../utils/validation";

export function GuidedFields({
  config,
  setConfig,
  errors,
  limits,
}: {
  config: Options;
  setConfig: (o: Options) => void;
  errors: OptionErrors;
  limits: NonNullable<State["limits"]>;
}) {
  const g = limits.guided;
  const select = (
    key: "object_count" | "threads" | "max_runtime_seconds",
    label: string,
    values: number[],
    hint: string,
    suffix = "",
  ) => (
    <NativeSelect
      label={label}
      value={config[key]}
      error={errors[key]}
      description={!errors[key] ? hint : undefined}
      onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
      data={values.map((v) => ({ value: String(v), label: `${v}${suffix}` }))}
    />
  );
  return (
    <div className="my-xl grid grid-cols-2 gap-panel max-[47.5rem]:grid-cols-1">
      {select(
        "object_count",
        "Maximum objects",
        g.object_counts,
        "Stop after this many objects.",
      )}
      <NativeSelect
        label="Object size"
        value={config.object_size}
        error={errors.object_size}
        description={
          !errors.object_size ? "Size of each test object." : undefined
        }
        onChange={(e) => setConfig({ ...config, object_size: e.target.value })}
        data={g.object_sizes}
      />
      {select(
        "threads",
        "Parallel threads",
        g.threads,
        "Concurrent requests from each client machine.",
      )}
      {select(
        "max_runtime_seconds",
        "Safety time limit",
        g.max_runtime_seconds,
        "Maximum configured runtime.",
        " seconds",
      )}
    </div>
  );
}
