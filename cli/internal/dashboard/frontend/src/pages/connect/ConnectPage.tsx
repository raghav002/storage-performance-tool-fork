import { Alert, Button, NativeSelect, Paper, Text, Title } from "@mantine/core";
import { useState } from "react";
import type { State } from "../../types";
import { useAttachRun, useDetachRun } from "../../api/mutations";

export function ConnectPage({
  state,
  offline,
  onConnected,
}: {
  state: State | null;
  offline: boolean;
  onConnected: () => void;
}) {
  const hosts = state?.storage?.hosts ?? [];
  const attached = state?.connection?.mode === "attached";
  const [host, setHost] = useState(hosts[0] ?? "");
  const attach = useAttachRun();
  const detach = useDetachRun();
  const busy = attach.isPending || detach.isPending;
  const error = attach.error?.message || detach.error?.message || "";
  const nextHost =
    attached && state?.connection?.host
      ? state.connection.host
      : !hosts.includes(host) && hosts.length
        ? hosts[0]
        : host;
  if (host !== nextHost) setHost(nextHost);

  const connect = () => {
    if (busy || !hosts.includes(host)) return;
    detach.reset();
    attach.mutate(host, { onSuccess: onConnected });
  };

  const disconnect = () => {
    if (busy) return;
    attach.reset();
    detach.mutate(undefined, { onSuccess: onConnected });
  };

  return (
    <div className="mx-auto w-full max-w-220">
      <div className="flex justify-between items-center mb-6.5 gap-md max-[47.5rem]:items-start max-[47.5rem]:flex-col">
        <div className="min-w-0">
          <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
            READ ONLY MONITORING
          </span>
          <Title order={1}>Connect to an active run</Title>
          <Text size="sm" className="mt-xs wrap-anywhere">
            Follow a run started from the SPT CLI. This connection reads live
            status and measurements and does not start or stop the benchmark.
          </Text>
        </div>
      </div>
      {error && (
        <Alert color="red" role="alert">
          <strong>Could not connect. </strong>
          {error}
          {hosts.includes(host) && (
            <div className="mt-sm flex flex-wrap items-center gap-compact">
              <Button onClick={() => void connect()} disabled={busy || offline}>
                Retry connection
              </Button>
            </div>
          )}
        </Alert>
      )}
      <Paper
        component="section"
        className="mb-panel p-wide max-[47.5rem]:p-4.25"
      >
        {attached ? (
          <>
            <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
              CURRENT CONNECTION
            </span>
            <Title order={2} className="mt-compact">
              Monitoring {state?.connection?.host}
            </Title>
            <Text className="mt-xs max-w-162.5">
              Run {state?.connection?.run_id ?? "—"} · Updates with the SPT
              status API and live metrics endpoint on port 9999.
            </Text>
            <div className="flex items-center justify-between gap-md mt-wide max-[38.75rem]:items-stretch max-[38.75rem]:flex-col">
              <span className="inline-flex items-center gap-xs text-[#356c58] text-sm/[inherit]">
                <i className="inline-block w-1.75 h-1.75 bg-[#188a82] rounded-full mr-xs" />{" "}
                Connected · read only
              </span>
              <div className="flex flex-wrap items-center gap-compact">
                {offline && (
                  <Button onClick={() => void connect()} disabled={busy}>
                    Retry connection
                  </Button>
                )}
                <Button onClick={() => void disconnect()} disabled={busy}>
                  Disconnect
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
              EXISTING SPT RUN
            </span>
            <Title order={2} className="mt-compact">
              Choose its entry machine
            </Title>
            <Text className="mt-xs max-w-162.5">
              SPT’s entry machine serves the documented /status and
              /metrics/json APIs. Choose a client machine already saved in
              Storage configuration.
            </Text>
            {hosts.length ? (
              <NativeSelect
                label="Entry machine"
                className="my-6.5 max-w-105"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                disabled={busy || offline}
              >
                {hosts.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <div className="p-lg bg-surface-review rounded-md mb-lg">
                <strong>No client machines are configured yet.</strong>
                <Text size="sm" className="mt-xs">
                  Add the SPT entry machine in Configure run → Storage
                  configuration, then return here.
                </Text>
              </div>
            )}
            <div className="flex items-center justify-between gap-md mt-wide max-[38.75rem]:items-stretch max-[38.75rem]:flex-col">
              <span className="text-subtle text-xs/[inherit]">
                The run must already be active on the selected machine.
              </span>
              <Button
                variant="filled"
                loading={busy}
                onClick={() => void connect()}
                disabled={!hosts.includes(host) || busy || offline}
              >
                {busy ? "Connecting…" : "Connect to active run"}
              </Button>
            </div>
          </>
        )}
      </Paper>
    </div>
  );
}
