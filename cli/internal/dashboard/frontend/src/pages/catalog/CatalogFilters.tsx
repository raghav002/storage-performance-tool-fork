import { NativeSelect, Paper, Text, TextInput } from "@mantine/core";
import {
  maxCompare,
  type CatalogFilters as FilterValues,
} from "../../utils/catalog";

export function CatalogFilters({
  filters,
  onChange,
}: {
  filters: FilterValues;
  onChange: (filters: FilterValues) => void;
}) {
  return (
    <Paper
      component="section"
      p="panel"
      mb="comfortable"
      className="flex flex-wrap items-end gap-3.5"
      aria-label="Filters"
    >
      <TextInput
        label="Search"
        type="search"
        value={filters.q}
        placeholder="Run name, label, size, endpoint host"
        onChange={(e) => onChange({ ...filters, q: e.target.value })}
        className="min-w-0 flex-[1_1_17.5rem]"
      />
      <NativeSelect
        label="Source"
        value={filters.source}
        onChange={(e) =>
          onChange({
            ...filters,
            source: e.target.value as FilterValues["source"],
          })
        }
      >
        <option value="">All sources</option>
        <option value="dashboard">Dashboard</option>
        <option value="cli">CLI</option>
      </NativeSelect>
      <NativeSelect
        label="Status"
        value={filters.status}
        onChange={(e) =>
          onChange({
            ...filters,
            status: e.target.value as FilterValues["status"],
          })
        }
      >
        <option value="">All statuses</option>
        <option value="complete">Complete</option>
        <option value="partial">Partial</option>
        <option value="malformed">Malformed</option>
        <option value="failed">Integrity failed</option>
      </NativeSelect>
      <Text size="sm" className="basis-full">
        Select 2–{maxCompare} runs to compare; the baseline is the run the
        others are checked against. "Compare with previous" pairs this run with
        the next older complete run that shares the same workload, object size,
        threads, and (when recorded) object count, host count, and S3 driver —
        not an SPT product version. Falls back to the next older complete run
        when no shape match exists.
      </Text>
    </Paper>
  );
}
