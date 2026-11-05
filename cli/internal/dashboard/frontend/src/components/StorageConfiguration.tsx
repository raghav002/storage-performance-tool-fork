import { Plus } from "lucide-react";
import {
  Accordion,
  Alert,
  Button,
  Code,
  Fieldset,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";
import type { State } from "../types";
import { useVerifyStorage } from "../api/mutations";
import { ConnectionGraph } from "./ConnectionGraph";
import { Status } from "./Status";
import { endpointError, hostErrors } from "../utils/validation";

type Form = { hosts: string[]; endpoint: string };

export function StorageConfiguration({
  state,
  offline,
  onDirty,
}: {
  state: State | null;
  offline: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const saved = state?.storage;
  const [form, setForm] = useState<Form | null>(null);
  const [validationError, setValidationError] = useState("");
  const verification = useVerifyStorage();
  const busy = verification.isPending;
  const error = validationError || verification.error?.message || "";
  // Copy the saved settings once; later polls must not overwrite what is being typed.
  if (saved && !form) {
    setForm({ hosts: [...saved.hosts], endpoint: saved.endpoint });
  }

  const entered = (form?.hosts ?? []).map((h) => h.trim()).filter(Boolean);
  const dirty =
    !!saved &&
    !!form &&
    (entered.join(",") !== saved.hosts.join(",") ||
      form.endpoint.trim() !== saved.endpoint);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  if (!saved || !form)
    return (
      <Text size="sm" className="my-comfortable">
        Waiting for the dashboard server…
      </Text>
    );

  const v = saved.verification,
    running = v.status === "running",
    locked = busy || running,
    target = state!.target;
  const rowErrors = hostErrors(form.hosts, saved.max_hosts),
    urlError = endpointError(form.endpoint.trim()),
    invalid = rowErrors.some(Boolean) || !!urlError;
  const setHost = (index: number, value: string) =>
    setForm({
      ...form,
      hosts: form.hosts.map((h, i) => (i === index ? value : h)),
    });

  function verify() {
    if (locked || !form || offline || state?.job?.status === "running") return;
    if (!entered.length) {
      setValidationError("Add at least one client machine.");
      return;
    }
    if (invalid) {
      setValidationError("Fix the highlighted fields before verifying.");
      return;
    }
    setValidationError("");
    verification.mutate(
      { hosts: entered, endpoint: form.endpoint.trim() },
      { onSuccess: (_response, settings) => setForm(settings) },
    );
  }

  return (
    <>
      <div className="mx-0 my-section p-comfortable flex gap-[26px] items-center flex-wrap bg-surface-subtle border border-border rounded-md [@media(max-width:760px)]:gap-comfortable">
        <div className="grid gap-[7px] min-w-0">
          <span className="text-xs/[inherit] text-muted">
            S3 endpoint in use
          </span>
          <strong className="text-sm/[inherit] wrap-anywhere">
            {target.endpoint_label || "Not configured"}
          </strong>
        </div>
        <div className="grid gap-[7px] min-w-0">
          <span className="text-xs/[inherit] text-muted">Bucket</span>
          <strong className="text-sm/[inherit] wrap-anywhere">
            {target.bucket || "Not reported"}
          </strong>
        </div>
        <Status status={target.ready ? "ready" : "needs setup"} />
      </div>
      {!!target.reasons?.length && (
        <Alert role="note">{target.reasons.join(" ")}</Alert>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
      >
        <Fieldset legend="Client machines" disabled={locked}>
          <Text size="sm" className="my-comfortable">
            The machines that generate load. Each needs Docker and key-based SSH
            access from the dashboard host. Enter{" "}
            <Code fz="caption">user@host</Code>, or{" "}
            <Code fz="caption">127.0.0.1</Code> for the dashboard host itself.
          </Text>
          <ul className="m-0 mb-sm grid list-none gap-compact p-0">
            {form.hosts.map((host, i) => (
              <li key={i} className="flex items-start gap-compact">
                <TextInput
                  className="min-w-0 flex-1"
                  styles={{
                    input: {
                      fontFamily: "var(--mantine-font-family-monospace)",
                    },
                  }}
                  aria-label={`Client machine ${i + 1}`}
                  placeholder="user@hostname"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={300}
                  value={host}
                  error={rowErrors[i]}
                  onChange={(e) => setHost(i, e.target.value)}
                />
                <Button
                  type="button"
                  disabled={form.hosts.length === 1}
                  aria-label={`Remove client machine ${i + 1}`}
                  onClick={() =>
                    setForm({
                      ...form,
                      hosts: form.hosts.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <Button
            leftSection={<Plus size={16} aria-hidden="true" />}
            type="button"
            disabled={form.hosts.length >= saved.max_hosts}
            onClick={() => setForm({ ...form, hosts: [...form.hosts, ""] })}
          >
            Add machine
          </Button>
          <Text
            component="span"
            size="caption"
            c="var(--spt-text-subtle)"
            className="ml-sm"
          >
            {form.hosts.length} of {saved.max_hosts}
          </Text>
          <TextInput
            className="mt-[26px] mb-panel"
            label="S3 endpoint (optional)"
            type="url"
            placeholder={
              target.endpoint_source === "env" && target.endpoint
                ? `${target.endpoint} (from the host)`
                : "https://s3.example.com or http://127.0.0.1:9000"
            }
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            value={form.endpoint}
            error={urlError}
            description="Use HTTP or HTTPS. Prefer HTTPS when the endpoint is outside a trusted private network. Leave blank to use the endpoint configured on the host. The bucket and access keys always come from the host."
            onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
          />
        </Fieldset>
        <div className="flex flex-wrap items-center gap-compact">
          <Button
            variant="filled"
            loading={locked}
            type="submit"
            disabled={
              locked || offline || invalid || state?.job?.status === "running"
            }
          >
            {locked ? "Verifying…" : "Verify connection"}
          </Button>
          <span className="text-subtle text-xs/[inherit]" role="status">
            {running
              ? "Checking each machine. This can take a few minutes."
              : dirty
                ? "Settings changed. Verify to apply them."
                : v.status === "idle"
                  ? "Not verified yet."
                  : v.summary}
          </span>
        </div>
      </form>
      {error && (
        <Alert color="red" role="alert" mt="lg">
          {error}
        </Alert>
      )}
      {v.status !== "idle" && !dirty && (
        <>
          <ConnectionGraph verification={v} />
          {[
            ...v.nodes,
            {
              host: v.endpoint.label || "S3 endpoint",
              status: v.endpoint.status,
              message: v.endpoint.message,
              checks: [],
            },
          ]
            .filter((n) => n.status === "failed")
            .map((n) => (
              <Accordion
                key={n.host}
                defaultValue="section"
                classNames={{ label: "wrap-anywhere" }}
                mt="md"
                styles={{
                  item: {
                    backgroundColor: "var(--spt-status-error-background)",
                    borderColor: "var(--spt-status-error-border)",
                  },
                  control: { color: "var(--spt-status-error-text)" },
                }}
              >
                <Accordion.Item value="section">
                  <Accordion.Control>
                    {n.host} failed{n.message ? `: ${n.message}` : ""}
                  </Accordion.Control>
                  <Accordion.Panel>
                    {n.checks.length > 0 && (
                      <ul className="mt-compact pl-comfortable text-secondary leading-code">
                        {n.checks.map((c) => (
                          <Text
                            component="li"
                            key={c.name}
                            size="sm"
                            lh="code"
                            c={
                              c.status === "fail"
                                ? "var(--spt-threshold-failure)"
                                : "var(--spt-text-secondary)"
                            }
                          >
                            <strong>{c.name}</strong> {c.status.toUpperCase()} ·{" "}
                            {c.message}
                          </Text>
                        ))}
                      </ul>
                    )}
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            ))}
        </>
      )}
    </>
  );
}
