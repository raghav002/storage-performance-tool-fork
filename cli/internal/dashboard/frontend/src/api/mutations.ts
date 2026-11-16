import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import {
  attachRun,
  detachRun,
  startRun,
  stopRun,
  verifyStorage,
} from "./requests";

function invalidateRunData(client: QueryClient) {
  return Promise.all(
    [queryKeys.state, queryKeys.runs, queryKeys.catalogRoot].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

export function useVerifyStorage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: verifyStorage,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.state }),
  });
}

export function useStartRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: startRun,
    onSuccess: () => invalidateRunData(client),
  });
}

export function useAttachRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: attachRun,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.state }),
  });
}

export function useStopRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: stopRun,
    onSuccess: () => invalidateRunData(client),
  });
}

export function useDetachRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: detachRun,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.state }),
  });
}
