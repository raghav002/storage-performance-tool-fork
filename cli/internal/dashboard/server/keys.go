package server

// JSON keys and values shared by several handlers.
const (
	keyError             = "error"
	keyRunID             = "run_id"
	keyStatus            = "status"
	keyMessage           = "message"
	keyJob               = "job"
	keyOptions           = "options"
	keyPhase             = "phase"
	keyThreads           = "threads"
	keyMax               = "max"
	keyMaxRuntimeSeconds = "max_runtime_seconds"
	keyElapsedSeconds    = "elapsed_seconds"
	keyIsActive          = "is_active"
	keySamples           = "samples"
	keyChartSamples      = "chart_samples"
	keyTimestamp         = "timestamp"
	keyCountFailed       = "count_failed"
	keyCumulativeOps     = "cumulative_ops"
	keyIsAggregate       = "is_aggregate"
	keyMin               = "min"
	keyStartedAt         = "started_at"
	keyUpdatedAt         = "updated_at"
	keyWorkloadType      = "workload_type"
	keySourceFile        = "source_file"
	keyIntervalIOPS      = "interval_iops"

	metricBandwidth  = "bandwidth_mib_s"
	metricP50Latency = "p50_latency_us"

	driverWriteVerify = "write-verify"

	// History chart query kind (the "kind" parameter).
	kindWindow = "window"

	// SPT phase codes as the history and live APIs report them, and the
	// verify phase's display name.
	phaseCreate      = "CREATE"
	phaseVerify      = "VERIFY"
	phaseDelete      = "DELETE"
	phaseVerifyLabel = "Verify"

	// Storage verification states.
	verifyPassed  = "passed"
	verifyFailed  = "failed"
	verifyPending = "pending"
	verifyRunning = "running"

	msgEndpointNotFound = "Endpoint not found."
	msgSavedRunNotFound = "Saved run not found."
)
