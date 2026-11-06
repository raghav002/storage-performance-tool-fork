import { Alert, Button, Text } from "@mantine/core";
import { useState } from "react";
import type { RunMode } from "./types";
import type { Page } from "./pages/types";
import { useSavedRun, useServerState } from "./api/queries";
import { AppSidebar } from "./components/layout/AppSidebar";
import { AppHeader } from "./components/layout/AppHeader";
import { AppFooter } from "./components/layout/AppFooter";
import { ConfigurePage } from "./pages/configure/ConfigurePage";
import { HistoryPage } from "./pages/history/HistoryPage";
import { ConnectPage } from "./pages/connect/ConnectPage";
import { CatalogPage } from "./pages/catalog/CatalogPage";
import { ComparePage } from "./pages/compare/ComparePage";
import { DashboardPage } from "./pages/dashboard/DashboardPage";
import { ViewSettingsDrawer } from "./pages/dashboard/ViewSettingsDrawer";
import { allSectionKeys } from "./pages/dashboard/sections";
import { useDashboardPreferences } from "./pages/dashboard/useDashboardPreferences";
import { utc } from "./utils/metrics";

export default function App() {
  const server = useServerState();
  const state = server.data ?? null;
  const error = server.error?.message ?? "";
  const received = server.dataUpdatedAt
    ? new Date(server.dataUpdatedAt).toISOString()
    : "";
  const [page, setPage] = useState<Page>("configure");
  const [compareIDs, setCompareIDs] = useState<string[]>([]),
    [compareBaseline, setCompareBaseline] = useState("");
  const [landed, setLanded] = useState(false);
  // Open on the live view only when a run is already in progress at first load.
  if (state && !landed) {
    setLanded(true);
    if (state.job?.status === "running") setPage("dashboard");
  }
  const [mode, setMode] = useState<RunMode>("guided");
  const [selection, setSelection] = useDashboardPreferences();
  const [customizing, setCustomizing] = useState(false);
  const [historyRunID, setHistoryRunID] = useState<string | null>(null);
  const savedRun = useSavedRun(
    page === "history" || page === "dashboard" ? historyRunID : null,
  );
  const historyState = historyRunID ? (savedRun.data ?? null) : null;
  // Keep the history list visible until the selected run has finished loading.
  if (
    page === "history" &&
    historyRunID &&
    savedRun.isSuccess &&
    !savedRun.isFetching
  ) {
    setCustomizing(false);
    setPage("dashboard");
  }

  const openSavedRun = (runID: string) => {
    if (historyRunID === runID) void savedRun.refetch();
    else setHistoryRunID(runID);
  };

  const showDashboard = () => {
    setHistoryRunID(null);
    setCustomizing(false);
    setPage("dashboard");
  };

  const showHistory = () => {
    setHistoryRunID(null);
    setPage("history");
  };

  return (
    <div className="flex min-h-screen max-[47.5rem]:block">
      <AppSidebar
        state={state}
        error={error}
        page={page}
        onNavigate={(nextPage) => {
          if (nextPage === "dashboard") showDashboard();
          else if (nextPage === "history") showHistory();
          else {
            if (nextPage === "configure") setHistoryRunID(null);
            setPage(nextPage);
          }
        }}
      />
      <div className="min-w-0 flex-1">
        <AppHeader
          state={state}
          error={error}
          mode={mode}
          onModeChange={(nextMode) => {
            setMode(nextMode);
            setCustomizing(false);
            // On Configure, the mode switches the workload form in place.
            if (page !== "configure") showDashboard();
          }}
        />
        <main className="mx-auto max-w-387.5 px-xxl py-8 min-[93.75rem]:pt-10 max-[71.875rem]:p-section max-[47.5rem]:px-md max-[47.5rem]:py-panel">
          {error && (
            <Alert color="red" role="alert">
              <strong>Connection unavailable. </strong>
              {error}
              {received && (
                <Text>
                  Showing the last received state from {utc(received)}. Run
                  controls are disabled until the connection returns.
                </Text>
              )}
            </Alert>
          )}
          {page === "connect" ? (
            <ConnectPage
              state={state}
              offline={!!error}
              onConnected={showDashboard}
            />
          ) : page === "catalog" ? (
            <CatalogPage
              onCompare={(ids, baseline) => {
                setCompareIDs(ids);
                setCompareBaseline(baseline);
                setPage("compare");
              }}
            />
          ) : page === "compare" ? (
            <ComparePage
              key={compareIDs.join(",") + compareBaseline}
              ids={compareIDs}
              baseline={compareBaseline}
              onBack={() => setPage("catalog")}
            />
          ) : page === "history" ? (
            <HistoryPage
              opening={!!historyRunID && savedRun.isFetching}
              error={savedRun.error?.message ?? ""}
              onOpen={openSavedRun}
              onRefresh={() => setHistoryRunID(null)}
            />
          ) : page === "configure" ? (
            <ConfigurePage
              state={state}
              mode={mode}
              offline={!!error}
              onStarted={showDashboard}
            />
          ) : (
            <>
              {mode === "expert" && (
                <div className="flex justify-end mb-comfortable">
                  <Button type="button" onClick={() => setCustomizing(true)}>
                    Customize view
                  </Button>
                </div>
              )}
              <DashboardPage
                key={
                  historyState?.job?.run_id ??
                  state?.metrics?.run_id ??
                  state?.job?.run_id ??
                  "empty"
                }
                state={historyState ?? state}
                historical={!!historyState}
                onBackHistory={showHistory}
                selected={mode === "guided" ? allSectionKeys() : selection}
                onConfigure={() => setPage("configure")}
              />
              {mode === "expert" && (
                <ViewSettingsDrawer
                  opened={customizing}
                  onClose={() => setCustomizing(false)}
                  selection={selection}
                  onSelectionChange={setSelection}
                />
              )}
            </>
          )}
        </main>
        <AppFooter state={state} received={received} />
      </div>
    </div>
  );
}
