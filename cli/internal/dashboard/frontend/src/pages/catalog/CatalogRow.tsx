import { Button, Checkbox, Radio, Table, Text } from "@mantine/core";
import type { CatalogRun } from "../../types";
import { Status } from "../../components/Status";
import { formatNumber as fmt } from "../../utils/metrics";
import { runSettings } from "../../utils/catalog";
import { CatalogRunDetails } from "./CatalogRunDetails";

const integrityText: Record<CatalogRun["integrity"], string> = {
  passed: "Integrity passed",
  failed: "Integrity failed",
  incomplete: "Integrity incomplete",
  not_recorded: "Integrity not recorded",
};

export function CatalogRow({
  run,
  checked,
  full,
  isBaseline,
  open,
  previous,
  onToggle,
  onBaseline,
  onOpen,
  onComparePrevious,
}: {
  run: CatalogRun;
  checked: boolean;
  full: boolean;
  isBaseline: boolean;
  open: boolean;
  previous: CatalogRun | null;
  onToggle: () => void;
  onBaseline: () => void;
  onOpen: () => void;
  onComparePrevious: (prevId: string) => void;
}) {
  return (
    <>
      <Table.Tr
        bg={
          run.status === "malformed"
            ? "var(--spt-status-warning-background)"
            : undefined
        }
      >
        <Table.Td ta="center">
          <Checkbox
            className="inline-flex"
            aria-label={`Compare ${run.id}`}
            checked={checked}
            disabled={!checked && (full || run.status === "malformed")}
            onChange={onToggle}
          />
        </Table.Td>
        <Table.Td ta="center">
          <Radio
            className="inline-flex"
            name="baseline"
            aria-label={`Use ${run.id} as baseline`}
            checked={isBaseline}
            disabled={!checked}
            onChange={onBaseline}
          />
        </Table.Td>
        <Table.Td
          ff="monospace"
          fz="caption"
          className="min-w-45 max-w-75 whitespace-normal wrap-anywhere"
        >
          {run.id}
          <Text
            component="small"
            size="caption"
            c="var(--spt-text-muted)"
            lh="normal"
            className="mt-0.75 block"
          >
            {run.source === "dashboard" ? "Dashboard" : "CLI"}
            {run.label ? ` · ${run.label}` : ""}
          </Text>
        </Table.Td>
        <Table.Td>
          {run.started_at
            ? run.started_at
                .replace("T", " ")
                .replace(/\.\d+/, "")
                .replace("Z", "")
            : "—"}
        </Table.Td>
        <Table.Td className="min-w-40 whitespace-normal">
          {runSettings(run)}
        </Table.Td>
        <Table.Td>
          <Status status={run.status} />
          <Text
            component="small"
            size="caption"
            c="var(--spt-text-muted)"
            lh="normal"
            className="mt-0.75 block"
          >
            {integrityText[run.integrity]}
          </Text>
        </Table.Td>
        <Table.Td>
          {run.phases.length ? (
            run.phases.map((p) => (
              <Text
                component="span"
                size="caption"
                c="var(--spt-text-secondary)"
                lh="normal"
                className="my-0.75 mr-compact inline-block"
                key={p.key}
              >
                {p.key} {fmt(p.iops, 1)}
              </Text>
            ))
          ) : (
            <Text
              component="span"
              size="xs"
              c="var(--spt-text-subtle)"
              lh="normal"
            >
              No phase totals
            </Text>
          )}
        </Table.Td>
        <Table.Td>
          <div className="flex flex-col items-stretch gap-[0.35rem]">
            <Button
              className="whitespace-nowrap"
              aria-expanded={open}
              onClick={onOpen}
            >
              {open ? "Hide" : "Details"}
            </Button>
            {run.status === "complete" && previous && (
              <Button
                className="whitespace-nowrap"
                type="button"
                title={`Compare with ${previous.name || previous.id}`}
                onClick={() => onComparePrevious(previous.id)}
              >
                Compare with previous
              </Button>
            )}
          </div>
        </Table.Td>
      </Table.Tr>
      {open && <CatalogRunDetails run={run} />}
    </>
  );
}
