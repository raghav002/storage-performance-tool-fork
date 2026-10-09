export type Options = {
  object_count: number;
  object_size: string;
  threads: number;
  max_runtime_seconds: number;
};
export type Row = {
  timestamp?: string;
  op_type?: string;
  phase?: string;
  step_id?: string;
  source_file?: string;
  elapsed_seconds?: number | null;
  duration_seconds?: number | null;
  cumulative_ops?: number | null;
  successful_ops?: number | null;
  count_failed?: number | null;
  failed_ops?: number | null;
  average_iops?: number | null;
  interval_iops?: number | null;
  iops?: number | null;
  bandwidth_mib_s?: number | null;
  p50_latency_us?: number | null;
  completion_percent?: number | null;
  bytes_processed?: number | null;
  concurrency?: number | null;
  concurrency_mean?: number | null;
  node_count?: number | null;
  corrupt_ops?: number | null;
  latency_mean_us?: number | null;
  latency_min_us?: number | null;
  latency_max_us?: number | null;
  latency_p99_us?: number | null;
};
export type Metrics = {
  run_id: string;
  updated_at?: string;
  source_file?: string;
  workload_type?: string;
  is_active: boolean;
  is_aggregate: boolean;
  phase?: string;
  progress_percent?: number | null;
  samples: Row[];
  chart_samples?: Row[];
  phase_summaries?: Row[];
  total_failed?: number | null;
};
export type Job = {
  run_id: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  elapsed_seconds?: number;
  phase?: string;
  message?: string;
  returncode?: number | null;
  prefix?: string;
  options?: Options;
};
export type State = {
  target: {
    ready: boolean;
    reasons?: string[];
    endpoint?: string;
    endpoint_label?: string;
    bucket?: string;
    credentials_configured?: boolean;
  };
  job: Job | null;
  metrics: Metrics | null;
};
export type HistoryRun = {
  run_id: string;
  started_at?: string;
  status: string;
  options?: Partial<Options>;
  phase_summaries: Row[];
};
export type Sample = {
  timestamp: string;
  elapsed: number;
  throughput: number | null;
  bandwidth: number | null;
  p50: number | null;
  p99: number | null;
  row: Row;
};
