import {
  Accordion,
  Button,
  Paper,
  SegmentedControl,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";
import type { LogLevel, LogResponse } from "../types";
import { useLog } from "../api/queries";

const levels: { value: LogLevel; label: string }[] = [
  { value: "all", label: "All" },
  { value: "warn", label: "WARN+" },
  { value: "error", label: "ERROR" },
];

/**
 * Read-only log viewer. `base` is /api/catalog/log?id=… or /api/runs/{id}/log.
 * Dashboard runs can switch between the console capture (interim, while SPT runs)
 * and the engine's results logs.
 */
export function RunLog({
  base,
  sources,
  title = "Run log",
  refreshMs = 0,
  collapsed = false,
}: {
  base: string;
  sources?: ("console" | "results")[];
  title?: string;
  refreshMs?: number;
  /** Start collapsed so long traces stay hidden until requested. */
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const [level, setLevel] = useState<LogLevel>("all");
  const [source, setSource] = useState<LogResponse["source"] | "">(
    sources?.[0] ?? "",
  );
  // Unmount the query observer on close so its in-flight request is cancelled.
  const body = open ? (
    <LogContents
      base={base}
      sources={sources}
      title={title}
      refreshMs={refreshMs}
      collapsed={collapsed}
      level={level}
      source={source}
      setLevel={setLevel}
      setSource={setSource}
    />
  ) : null;
  return collapsed ? (
    <Accordion
      mb="panel"
      aria-label={title}
      value={open ? "log" : null}
      onChange={(value) => setOpen(value === "log")}
      keepMounted={false}
    >
      <Accordion.Item value="log">
        <Accordion.Control>{title}</Accordion.Control>
        <Accordion.Panel>{body}</Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  ) : (
    <Paper component="section" p="panel" mb="panel" aria-label={title}>
      {body}
    </Paper>
  );
}

function LogContents({
  base,
  sources,
  title,
  refreshMs,
  collapsed,
  level,
  source,
  setLevel,
  setSource,
}: {
  base: string;
  sources?: LogResponse["source"][];
  title: string;
  refreshMs: number;
  collapsed: boolean;
  level: LogLevel;
  source: LogResponse["source"] | "";
  setLevel: (level: LogLevel) => void;
  setSource: (source: LogResponse["source"] | "") => void;
}) {
  const log = useLog(base, level, source, refreshMs);
  const data = log.isError ? undefined : log.data;
  const error = log.error?.message ?? "";
  const files = [...new Set(data?.lines.map((l) => l.file) ?? [])];
  return (
    <>
      <div className="flex flex-wrap gap-sm items-center">
        {!collapsed && (
          <Title order={3} className="flex-auto">
            {title}
          </Title>
        )}
        <SegmentedControl<LogLevel>
          aria-label="Log level"
          value={level}
          onChange={setLevel}
          data={levels}
        />
        {sources && sources.length > 1 && (
          <SegmentedControl<LogResponse["source"] | "">
            aria-label="Log source"
            value={source}
            onChange={setSource}
            data={sources.map((s) => ({
              value: s,
              label: s === "console" ? "Console (interim)" : "Results logs",
            }))}
          />
        )}
        <Button onClick={() => void log.refetch()}>Reload</Button>
      </div>
      {data?.interim && (
        <Text size="sm" className="my-comfortable">
          Interim console output captured by the dashboard. The engine’s results
          logs are the record once the run finishes.
        </Text>
      )}
      {error ? (
        <Text size="xs" c="var(--spt-text-subtle)">
          {error}
        </Text>
      ) : !data ? (
        <Text size="xs" c="var(--spt-text-subtle)">
          Loading log…
        </Text>
      ) : data.lines.length === 0 ? (
        <Text size="xs" c="var(--spt-text-subtle)">
          {level === "all"
            ? "No log lines recorded."
            : `No ${level === "warn" ? "warning or error" : "error"} lines recorded.`}
        </Text>
      ) : (
        <pre
          className="p-sm max-h-90 overflow-auto bg-[#101827] text-[#dbe4f0] rounded-md text-sm/help whitespace-pre-wrap wrap-anywhere"
          tabIndex={0}
        >
          {data.lines.map((l, i) => (
            <span
              key={i}
              className={
                l.level === "warn"
                  ? "text-[#f5c46b]"
                  : l.level === "error"
                    ? "text-[#ff8a80]"
                    : undefined
              }
            >
              {l.text}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
      {data?.truncated && (
        <Text size="sm" className="my-comfortable">
          Showing the end of a large log; older lines were not read.
        </Text>
      )}
      {files.length > 0 && (
        <Text size="sm" className="my-comfortable">
          From: {files.join(", ")}
        </Text>
      )}
      <Text size="sm" className="my-comfortable">
        Credential-looking values are redacted. Showing up to the last 200
        matching lines.
      </Text>
    </>
  );
}
