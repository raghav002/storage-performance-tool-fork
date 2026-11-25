import { Alert, Checkbox, Fieldset, NativeSelect, Text } from "@mantine/core";
import type { DeleteOptions, Options, RunLimits } from "../../types";
import { deleteLimits, type OptionErrors } from "../../utils/validation";

export function initialDeleteOptions(limits: RunLimits): Options {
  const d = limits.delete ?? deleteLimits;
  return {
    mode: "guided",
    workload: "delete",
    object_count: limits.guided.object_counts[0],
    object_size: d.object_sizes[0],
    threads: limits.guided.threads[0],
    max_runtime_seconds: 0,
    delete: {
      batch_size: d.batch_sizes[0],
      validate_inventory: false,
      verify: false,
      verification_timeout_seconds: d.verification_timeout_seconds.includes(30)
        ? 30
        : d.verification_timeout_seconds[0],
      max_failed_objects: d.max_failed_objects[0],
      cleanup: true,
    },
  };
}

export function DeleteFields({
  config,
  setConfig,
  errors,
  limits,
}: {
  config: Options;
  setConfig: (o: Options) => void;
  errors: OptionErrors;
  limits: RunLimits;
}) {
  const d = limits.delete ?? deleteLimits;
  const x = config.delete!;
  const update = (change: Partial<DeleteOptions>) =>
    setConfig({ ...config, delete: { ...x, ...change } });
  const numbers = (values: number[]) =>
    values.map((v) => ({ value: String(v), label: String(v) }));
  return (
    <div className="my-xl grid gap-lg">
      <Text size="sm">
        SPT creates a finite set under a unique run prefix. Only those test
        objects are selected for deletion.
      </Text>
      <Fieldset legend="Objects">
        <div className="grid grid-cols-2 gap-panel max-[47.5rem]:grid-cols-1">
          <NativeSelect
            label="Test objects"
            value={config.object_count}
            error={errors.object_count}
            data={numbers(limits.guided.object_counts)}
            onChange={(e) =>
              setConfig({
                ...config,
                object_count: Number(e.currentTarget.value),
              })
            }
          />
          <NativeSelect
            label="Seed object size"
            description="Size of objects created before deletion."
            value={config.object_size}
            error={errors.object_size}
            data={d.object_sizes}
            onChange={(e) =>
              setConfig({ ...config, object_size: e.currentTarget.value })
            }
          />
        </div>
      </Fieldset>
      <Fieldset legend="Load">
        <div className="grid grid-cols-2 gap-panel max-[47.5rem]:grid-cols-1">
          <NativeSelect
            label="Parallel requests"
            description="Concurrent requests per client machine."
            value={config.threads}
            error={errors.threads}
            data={numbers(limits.guided.threads)}
            onChange={(e) =>
              setConfig({ ...config, threads: Number(e.currentTarget.value) })
            }
          />
          <NativeSelect
            label="Objects per request"
            description="1 uses DeleteObject; larger batches use DeleteObjects."
            value={x.batch_size}
            data={numbers(d.batch_sizes)}
            onChange={(e) =>
              update({ batch_size: Number(e.currentTarget.value) })
            }
          />
        </div>
      </Fieldset>
      <Fieldset legend="Verification">
        <div className="grid gap-md">
          <Checkbox
            label="Check objects exist before deletion"
            checked={x.validate_inventory}
            onChange={(e) =>
              update({ validate_inventory: e.currentTarget.checked })
            }
          />
          <Checkbox
            label="Check objects are absent after deletion"
            checked={x.verify ?? x.validate_inventory}
            onChange={(e) => update({ verify: e.currentTarget.checked })}
          />
          <NativeSelect
            label="Verification timeout (seconds)"
            value={x.verification_timeout_seconds}
            data={numbers(d.verification_timeout_seconds)}
            onChange={(e) =>
              update({
                verification_timeout_seconds: Number(e.currentTarget.value),
              })
            }
          />
          <Text size="sm">
            Without post-verification, accepted requests do not confirm object
            removal.
          </Text>
        </div>
      </Fieldset>
      <Fieldset legend="Failure policy">
        <div className="grid gap-md">
          <NativeSelect
            label="Failure budget"
            value={x.max_failure_percent === undefined ? "count" : "percentage"}
            data={[
              { value: "count", label: "Failed-object count" },
              { value: "percentage", label: "Failed-object percentage" },
            ]}
            onChange={(e) =>
              update(
                e.currentTarget.value === "count"
                  ? {
                      max_failed_objects: d.max_failed_objects[0],
                      max_failure_percent: undefined,
                      failure_budget_grace_seconds: undefined,
                    }
                  : {
                      max_failed_objects: undefined,
                      max_failure_percent: d.max_failure_percent[0],
                      failure_budget_grace_seconds: undefined,
                    },
              )
            }
          />
          {x.max_failure_percent === undefined ? (
            <NativeSelect
              label="Allowed failed objects"
              value={x.max_failed_objects}
              data={numbers(d.max_failed_objects)}
              onChange={(e) =>
                update({ max_failed_objects: Number(e.currentTarget.value) })
              }
            />
          ) : (
            <>
              <NativeSelect
                label="Allowed failures (%)"
                value={x.max_failure_percent}
                data={numbers(d.max_failure_percent)}
                onChange={(e) =>
                  update({
                    max_failure_percent: Number(e.currentTarget.value),
                    failure_budget_grace_seconds:
                      Number(e.currentTarget.value) > 0
                        ? d.failure_budget_grace_seconds[0]
                        : undefined,
                  })
                }
              />
              {x.max_failure_percent > 0 && (
                <NativeSelect
                  label="Failure budget grace (seconds)"
                  value={x.failure_budget_grace_seconds ?? 30}
                  data={numbers(d.failure_budget_grace_seconds)}
                  onChange={(e) =>
                    update({
                      failure_budget_grace_seconds: Number(
                        e.currentTarget.value,
                      ),
                    })
                  }
                />
              )}
            </>
          )}
        </div>
      </Fieldset>
      <Fieldset legend="Cleanup">
        <Checkbox
          label="Retry deletion of leftover test objects"
          description="Runs after the measured test. Cleanup does not change the benchmark result."
          checked={x.cleanup}
          onChange={(e) => update({ cleanup: e.currentTarget.checked })}
        />
      </Fieldset>
      {errors.delete && <Alert color="red">{errors.delete}</Alert>}
    </div>
  );
}
