import { Paper, Table, Text, Title } from "@mantine/core";
import { useState } from "react";
import type { CatalogList, CatalogRun } from "../../types";
import { maxCompare, previousRun } from "../../utils/catalog";
import { CatalogRow } from "./CatalogRow";

export function CatalogTable({
  data,
  allRuns,
  loading,
  filtered,
  selected,
  effectiveBaseline,
  onToggle,
  onBaseline,
  onCompare,
}: {
  data: CatalogList | undefined;
  allRuns: CatalogRun[];
  loading: boolean;
  filtered: boolean;
  selected: string[];
  effectiveBaseline: string;
  onToggle: (runId: string) => void;
  onBaseline: (runId: string) => void;
  onCompare: (ids: string[], baseline: string) => void;
}) {
  const [open, setOpen] = useState("");
  const runs = data?.runs ?? [];
  return (
    <Paper component="section" className="mb-panel">
      {loading && !data ? (
        <Text className="px-section py-xxl text-center">Scanning results…</Text>
      ) : runs.length ? (
        <Table.ScrollContainer
          minWidth="var(--spt-table-min-width)"
          aria-label="Results catalog scroll area"
        >
          <Table aria-label="Results catalog" stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col" ta="center">
                  Compare
                </Table.Th>
                <Table.Th scope="col" ta="center">
                  Baseline
                </Table.Th>
                <Table.Th scope="col">Run</Table.Th>
                <Table.Th scope="col">Started · UTC</Table.Th>
                <Table.Th scope="col">Settings</Table.Th>
                <Table.Th scope="col">Status</Table.Th>
                <Table.Th scope="col">Phases · IOPS</Table.Th>
                <Table.Th scope="col" aria-label="Actions"></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.map((run) => (
                <CatalogRow
                  key={run.id}
                  run={run}
                  checked={selected.includes(run.id)}
                  full={selected.length >= maxCompare}
                  isBaseline={effectiveBaseline === run.id}
                  open={open === run.id}
                  previous={previousRun(
                    allRuns.length ? allRuns : runs,
                    run.id,
                  )}
                  onToggle={() => onToggle(run.id)}
                  onBaseline={() => onBaseline(run.id)}
                  onOpen={() => setOpen(open === run.id ? "" : run.id)}
                  onComparePrevious={(prevId) =>
                    onCompare([run.id, prevId], prevId)
                  }
                />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <div className="px-section py-xxl text-center">
          <Title order={2}>No runs found</Title>
          <Text className="mt-xs">
            {filtered
              ? "No runs match these filters."
              : "SPT result folders will appear here after a run."}
          </Text>
        </div>
      )}
      <Text size="caption" className="px-comfortable pb-md">
        {data ? `${runs.length} shown of ${data.total} found.` : ""} Malformed
        or partial folders are listed with what is missing.
      </Text>
    </Paper>
  );
}
