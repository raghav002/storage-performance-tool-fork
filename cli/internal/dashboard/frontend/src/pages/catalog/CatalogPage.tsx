import { Alert, Button, Text, Title } from "@mantine/core";
import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useCatalog, useLastSuccessfulData } from "../../api/queries";
import {
  toggleSelection,
  type CatalogFilters as FilterValues,
} from "../../utils/catalog";
import { CatalogFilters } from "./CatalogFilters";
import { CatalogTable } from "./CatalogTable";

export function CatalogPage({
  onCompare,
}: {
  onCompare: (ids: string[], baseline: string) => void;
}) {
  const [filters, setFilters] = useState<FilterValues>({
    q: "",
    source: "",
    status: "",
  });
  const [debouncedFilters] = useDebouncedValue(filters, 200);
  const catalog = useCatalog(debouncedFilters);
  const unfiltered = useCatalog({ q: "", source: "", status: "" });
  const data = useLastSuccessfulData(catalog.data);
  const allRuns = unfiltered.data?.runs ?? [];
  const error = catalog.error?.message ?? "";
  const loading = catalog.isFetching;
  const [selected, setSelected] = useState<string[]>([]);
  const [baseline, setBaseline] = useState("");
  const effectiveBaseline = selected.includes(baseline)
    ? baseline
    : (selected[0] ?? "");
  return (
    <>
      <div className="flex justify-between items-center mb-6.5 gap-md max-[47.5rem]:items-start max-[47.5rem]:flex-col">
        <div className="min-w-0">
          <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
            RESULTS CATALOG · READ ONLY
          </span>
          <Title order={1}>Results catalog</Title>
          <Text size="sm" className="mt-xs wrap-anywhere">
            Dashboard and CLI runs found under{" "}
            {data?.root ?? "the results folder"}. Nothing here changes or
            deletes results.
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-compact max-[47.5rem]:w-full">
          <Button
            onClick={() => {
              void catalog.refetch();
              if (
                debouncedFilters.q.trim() ||
                debouncedFilters.source ||
                debouncedFilters.status
              )
                void unfiltered.refetch();
            }}
            disabled={loading}
          >
            Rescan
          </Button>
          <Button
            variant="filled"
            disabled={selected.length < 2}
            onClick={() => onCompare(selected, effectiveBaseline)}
          >
            Compare {selected.length || ""} selected
          </Button>
        </div>
      </div>
      <CatalogFilters filters={filters} onChange={setFilters} />
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {data?.truncated && (
        <Alert color="yellow" role="note">
          The results folder is large; only part of it was scanned.
        </Alert>
      )}
      <CatalogTable
        data={data}
        allRuns={allRuns}
        loading={loading}
        filtered={!!(filters.q || filters.source || filters.status)}
        selected={selected}
        effectiveBaseline={effectiveBaseline}
        onToggle={(runId) =>
          setSelected((previous) => toggleSelection(previous, runId))
        }
        onBaseline={setBaseline}
        onCompare={onCompare}
      />
    </>
  );
}
