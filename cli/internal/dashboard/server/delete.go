package server

import (
	"fmt"
	"math"
	"slices"
	"strconv"
)

type deleteOptions struct {
	BatchSize           int      `json:"batch_size"`
	ValidateInventory   bool     `json:"validate_inventory"`
	Verify              *bool    `json:"verify,omitempty"`
	VerificationTimeout int      `json:"verification_timeout_seconds"`
	MaxFailedObjects    *int64   `json:"max_failed_objects,omitempty"`
	MaxFailurePercent   *float64 `json:"max_failure_percent,omitempty"`
	FailureBudgetGrace  *int     `json:"failure_budget_grace_seconds,omitempty"`
	Cleanup             bool     `json:"cleanup"`
}

type deleteLimits struct {
	ObjectSizes          []string  `json:"object_sizes"`
	BatchSizes           []int     `json:"batch_sizes"`
	VerificationTimeouts []int     `json:"verification_timeout_seconds"`
	FailureCounts        []int64   `json:"max_failed_objects"`
	FailurePercents      []float64 `json:"max_failure_percent"`
	GraceSeconds         []int     `json:"failure_budget_grace_seconds"`
}

func defaultDeleteLimits() deleteLimits {
	return deleteLimits{
		ObjectSizes:          []string{"1KiB", "4KiB", "64KiB"},
		BatchSizes:           []int{1, 10, 100, 1000},
		VerificationTimeouts: []int{10, 30, 60},
		FailureCounts:        []int64{0, 10, 100, 100000},
		FailurePercents:      []float64{0, 1, 5, 10, 100},
		GraceSeconds:         []int{0, 10, 30, 60},
	}
}

func (d deleteLimits) validate() error {
	if len(d.ObjectSizes) == 0 || len(d.BatchSizes) == 0 || len(d.VerificationTimeouts) == 0 || len(d.FailureCounts) == 0 || len(d.FailurePercents) == 0 || len(d.GraceSeconds) == 0 {
		return fmt.Errorf("dashboard delete limits must each contain at least one choice")
	}
	if hasDuplicates(d.ObjectSizes) || hasDuplicates(d.BatchSizes) || hasDuplicates(d.VerificationTimeouts) || hasDuplicates(d.FailureCounts) || hasDuplicates(d.FailurePercents) || hasDuplicates(d.GraceSeconds) {
		return fmt.Errorf("dashboard delete limits must not contain duplicate choices")
	}
	for _, v := range d.ObjectSizes {
		if _, ok := parseSize(v); !ok {
			return fmt.Errorf("invalid delete object size %q", v)
		}
	}
	for _, v := range d.BatchSizes {
		if v < 1 || v > 1000 {
			return fmt.Errorf("delete batch sizes must be between 1 and 1000")
		}
	}
	for _, v := range d.VerificationTimeouts {
		if v < 1 || v > 3600 {
			return fmt.Errorf("delete verification timeouts must be between 1 and 3600 seconds")
		}
	}
	for _, v := range d.FailureCounts {
		if v < 0 {
			return fmt.Errorf("delete failure counts must be nonnegative")
		}
	}
	for _, v := range d.FailurePercents {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 100 {
			return fmt.Errorf("delete failure percentages must be between 0 and 100")
		}
	}
	for _, v := range d.GraceSeconds {
		if v < 0 || v > 3600 {
			return fmt.Errorf("delete grace periods must be between 0 and 3600 seconds")
		}
	}
	return nil
}

func (a *app) validateWorkload(o options) error {
	if o.Workload != "" && o.Workload != driverWriteVerify && o.Workload != "delete" && o.Workload != driverMock {
		return userError("Choose a supported dashboard workload.")
	}
	if o.Workload == "delete" {
		if o.Mode != "" && o.Mode != modeGuided {
			return userError("Delete is available in Guided mode only.")
		}
		if o.Driver == driverMock {
			return userError("Delete requires the S3 storage driver.")
		}
		if o.Delete == nil {
			return userError("Choose the Delete settings.")
		}
	} else if o.Delete != nil {
		return userError("Delete settings require the Delete workload.")
	}
	if (o.Workload == driverMock && o.Driver != driverMock) || (o.Workload == driverWriteVerify && o.Driver == driverMock) {
		return userError("The workload and storage driver do not match.")
	}
	return nil
}

func (a *app) validateDelete(o options) error {
	s := a.effectiveSettings()
	g, d := s.Limits.Guided, s.Limits.Delete
	if !slices.Contains(g.ObjectCounts, o.ObjectCount) || !slices.Contains(d.ObjectSizes, o.ObjectSize) || !slices.Contains(g.Threads, o.Threads) {
		return userError("Choose a listed Delete object count, size, and thread count.")
	}
	size, ok := parseSize(o.ObjectSize)
	if !ok || size > s.Limits.Expert.MaxTotalBytes/int64(o.ObjectCount) {
		return userError("Delete test data exceeds the configured maximum total data.")
	}
	if o.MaxRuntimeSeconds != 0 {
		return userError("Count-based Delete does not accept a runtime limit.")
	}
	x := o.Delete
	if !slices.Contains(d.BatchSizes, x.BatchSize) || !slices.Contains(d.VerificationTimeouts, x.VerificationTimeout) {
		return userError("Choose a listed Delete batch size and verification timeout.")
	}
	if (x.MaxFailedObjects == nil) == (x.MaxFailurePercent == nil) {
		return userError("Choose either a failed-object count or a failure percentage.")
	}
	if x.MaxFailedObjects != nil && !slices.Contains(d.FailureCounts, *x.MaxFailedObjects) {
		return userError("Choose a listed failed-object count.")
	}
	if x.MaxFailurePercent != nil && !slices.Contains(d.FailurePercents, *x.MaxFailurePercent) {
		return userError("Choose a listed failure percentage.")
	}
	if x.FailureBudgetGrace != nil {
		if x.MaxFailurePercent == nil || *x.MaxFailurePercent <= 0 || !slices.Contains(d.GraceSeconds, *x.FailureBudgetGrace) {
			return userError("A listed grace period requires a positive failure percentage.")
		}
	}
	return nil
}

func (a *app) buildDeleteArgv(runDir, runID string, o options, target map[string]any) []string {
	x := o.Delete
	args := []string{a.sptBin, "run", "delete", "--headless", "--endpoints", fmt.Sprint(target["endpoint"]), "--bucket", fmt.Sprint(target["bucket"]), "--prefix", "dashboard/" + runID + "/", "--object-count", strconv.Itoa(o.ObjectCount), "--object-size", o.ObjectSize, "--threads", strconv.Itoa(o.Threads), "--test-hosts", targetHosts(target), "--service-threads", strconv.Itoa(o.Threads), "--s3-driver", "default", "--auth-version", "4", "--delete-batch-size", strconv.Itoa(x.BatchSize), "--validate-inventory=" + strconv.FormatBool(x.ValidateInventory), "--verification-timeout", strconv.Itoa(x.VerificationTimeout) + "s", "--label", sourceDashboard, "--results-dir", runDir}
	if x.Verify != nil {
		args = append(args, "--verify="+strconv.FormatBool(*x.Verify))
	}
	if x.MaxFailedObjects != nil {
		args = append(args, "--max-failed-objects", strconv.FormatInt(*x.MaxFailedObjects, 10))
	}
	if x.MaxFailurePercent != nil {
		args = append(args, "--max-failure-percent", strconv.FormatFloat(*x.MaxFailurePercent, 'f', -1, 64))
	}
	if x.FailureBudgetGrace != nil {
		args = append(args, "--failure-budget-grace", strconv.Itoa(*x.FailureBudgetGrace)+"s")
	}
	args = append(args, "--cleanup="+strconv.FormatBool(x.Cleanup))
	return args
}
