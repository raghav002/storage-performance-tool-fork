// Prewritten questions and answers for the help assistant. Every answer is
// taken from the dashboard README; keep them in step when the README changes.
// To add an entry: give it a stable id, the question as users should see it,
// 2-4 alternate phrasings for matching, and held-out phrasings in faq.test.ts.

import { buildIndex, match, type MatchEntry } from "./matcher";

/** How many "Did you mean?" suggestions to show at most. */
export const HELP_TOP_K = 3;

/**
 * Minimum similarity for a suggestion. Calibrated on faq.eval.ts by sweeping
 * 0.10-0.60: the best off-topic score was 0.214 and the weakest correct one
 * 0.228. At 0.25 every off-topic question is refused and 43 of 44 on-topic
 * questions have their answer in the top 3. Re-run the sweep after changing the
 * bank or the matcher.
 */
export const HELP_THRESHOLD = 0.25;

export interface FaqEntry extends MatchEntry {
  /** Paragraphs of plain text, rendered as text (never HTML). */
  answer: string[];
  /** Where the answer comes from, shown under it. */
  source: string;
}

const README = "Dashboard README";

export const faq: FaqEntry[] = [
  {
    id: "stop-run",
    question: "How do I stop a run?",
    alternates: [
      "Cancel a benchmark that is running",
      "End a test early",
      "What does the Stop run button do?",
    ],
    answer: [
      "On the live dashboard, press Stop run. It sends SPT one interrupt (SIGINT, or Ctrl+Break on Windows), the same signal the dashboard sends on Ctrl+C.",
      "SPT then tries to stop the engine test, remove its containers and collect results within its own time limits (about 2 minutes); none of that is guaranteed. The dashboard never force-kills SPT.",
    ],
    source: `${README} › Run`,
  },
  {
    id: "stopped-run-deleted",
    question: "Why did my stopped run disappear from Run history?",
    alternates: [
      "Where are the results of a run I stopped?",
      "My run is gone after I stopped it",
      "Are stopped runs saved?",
    ],
    answer: [
      "A run you stop was not wanted, so once SPT exits the dashboard deletes its results: its folder under the results directory and its saved live samples. It does not appear in Run history.",
      "Its log (<runID>.log in the dashboard state directory) and its run record are kept, so you can still check what happened. Only the stopped run's own folder is removed.",
    ],
    source: `${README} › Run`,
  },
  {
    id: "stopped-vs-interrupted",
    question: "What is the difference between stopped and interrupted?",
    alternates: [
      "What does stopped by user mean?",
      "Why does my run say interrupted?",
      "What is stopped_by?",
    ],
    answer: [
      "stopped · by user: you pressed Stop run, and the results were deleted.",
      "interrupted · by dashboard: the dashboard shut down (Ctrl+C) or restarted mid-run. interrupted · by outside: SPT was interrupted outside the dashboard (seen in its trace log). Interrupted runs are kept.",
      "A run that wrote its results summary and exited 0 before the stop reached it is recorded as completed. Runs that completed or failed on their own have no stopped_by, and returncode always holds SPT's real exit code.",
    ],
    source: `${README} › Run`,
  },
  {
    id: "stop-hidden",
    question: "Why is the Stop run button missing?",
    alternates: [
      "I can't stop the run from the dashboard",
      "Stop button not showing after a restart",
    ],
    answer: [
      "If the dashboard restarted during the run, it no longer holds the SPT process, so the button is hidden and the run can't be stopped from the UI.",
      "A run you are monitoring with Connect to active run is read only: the dashboard does not launch or stop it.",
    ],
    source: `${README} › Run, Monitor an existing SPT run`,
  },
  {
    id: "stop-slow",
    question: "Stop run is taking a long time. What should I do?",
    alternates: [
      "The run is stuck on Stopping",
      "The page says to check the VM",
    ],
    answer: [
      "SPT's own cleanup after a stop (stopping the engine test, removing containers, collecting results) takes up to about 2 minutes.",
      "Stop run never force-kills SPT. If SPT hasn't exited 3 minutes after the request, the page asks you to check the VM.",
    ],
    source: `${README} › Run`,
  },
  {
    id: "guided-vs-expert",
    question: "What is the difference between Guided and Expert mode?",
    alternates: [
      "Which mode should I use?",
      "What can I change in Expert mode?",
      "What are the preset choices?",
    ],
    answer: [
      "The Guided/Expert switch in the top bar selects how the workload step is configured. Guided offers preset choices; Expert accepts any value in a range.",
      "Default Guided presets: 10, 25, 50, 100, 250 or 320 objects; object size 64KiB, 256KiB, 1MiB, 4MiB or 16MiB; 1 or 2 threads; a runtime limit of 60, 120, 300 or 600 s.",
      "Default Expert ranges: 1–100,000 objects; object size 1KiB–1GiB in whole KiB, MiB or GiB; 1–64 threads; a runtime limit of 10–3600 s; at most 100 GiB of total test data (objects × size).",
    ],
    source: `${README} › Run modes`,
  },
  {
    id: "change-limits",
    question: "How do I change the run limits?",
    alternates: [
      "Increase the maximum object count",
      "Where is the dashboard settings file?",
      "Allow bigger objects or more threads",
    ],
    answer: [
      "Start the dashboard with --config path/to/dashboard.json, or set DASHBOARD_CONFIG. The server publishes the effective limits and validates every run request against them.",
      "limits.guided accepts the arrays object_counts, object_sizes, threads and max_runtime_seconds. limits.expert accepts object_count_min/max, object_size_bytes_min/max, threads_min/max, max_runtime_seconds_min/max and max_total_bytes. Omitted fields keep their defaults.",
    ],
    source: `${README} › Run modes`,
  },
  {
    id: "settings-locked",
    question: "Why can't I change the workload settings?",
    alternates: [
      "The workload step is locked",
      "Why can't I start a run?",
      "The start button is disabled",
    ],
    answer: [
      "Configure run has two steps. Workload settings stay locked until the storage step has been verified, and the server refuses to start a run without a passing verification. Changing the client machines or the endpoint requires verifying again.",
      "The dashboard allows one dashboard-managed run at a time, and verification and runs never overlap. If the page shows Connection unavailable, run controls stay disabled until the connection returns.",
    ],
    source: `${README} › Storage configuration`,
  },
  {
    id: "verify-connection",
    question: "What does Verify connection check?",
    alternates: [
      "Storage verification failed",
      "What is checked before a run?",
    ],
    answer: [
      "Verify connection saves the storage settings, calls SPT's typed verification API for the client machines, and checks that the S3 endpoint answers HTTP(S) from the dashboard host.",
      "The endpoint check proves reachability only, not credentials or bucket access. With the mock driver, only the client machines must pass.",
    ],
    source: `${README} › Storage configuration`,
  },
  {
    id: "client-machines",
    question: "What should I enter as client machines?",
    alternates: [
      "How do I add a host?",
      "Use more than one machine to generate load",
      "Can I use an SSH password?",
    ],
    answer: [
      "Client machines generate the load. Enter each as host or user@host, up to 8; 127.0.0.1 is the dashboard host. They are passed to SPT as --test-hosts, and the first one is the entry node.",
      "Each remote machine needs Docker and key-based SSH access from the dashboard host; passwords are not supported.",
    ],
    source: `${README} › Storage configuration`,
  },
  {
    id: "mock-driver",
    question: "What is the mock driver?",
    alternates: [
      "Run without S3 storage",
      "Mock driver or S3 write + verify?",
      "Try the dashboard without a bucket",
    ],
    answer: [
      "The mock driver runs spt run mock (SPT's dummy-mock storage driver). No S3 endpoint, bucket or credentials are used, so only the client machines must pass verification.",
      "Use it to check the client machines, the dashboard and the charts without touching storage. Mock results describe the mock driver, not storage performance, and the UI labels them Mock driver everywhere. S3 write + verify (the default) runs SPT's write/verify workload against the configured S3 target.",
    ],
    source: `${README} › Storage driver`,
  },
  {
    id: "ssh-tunnel",
    question: "How do I open the dashboard from my own computer?",
    alternates: [
      "Set up SSH port forwarding",
      "Access the dashboard on a remote server",
      "Open the dashboard in my local browser",
    ],
    answer: [
      "The server listens only on localhost. Run spt dashboard --no-browser on the server, then forward the port from your local machine: ssh -L 8000:127.0.0.1:8000 user@server.",
      "Open http://localhost:8000 in your local browser. If you choose another dashboard port, update the forwarding command to match.",
    ],
    source: `${README} › Run`,
  },
  {
    id: "loopback-403",
    question: 'Why do I get "Open the dashboard through its SSH tunnel"?',
    alternates: [
      "403 Forbidden from the dashboard",
      "Requests must come from this dashboard",
    ],
    answer: [
      "All endpoints answer only on loopback with a loopback Host header; any other host gets 403.",
      "Open the dashboard at 127.0.0.1:<port> or localhost:<port>, where <port> is the port the dashboard listens on. When you use an SSH tunnel, use that same port number on your end of the tunnel.",
    ],
    source: `${README} › HTTP API`,
  },
  {
    id: "dashboard-port",
    question: "How do I change the dashboard port?",
    alternates: [
      "Port 8000 is already in use",
      "Don't open a browser when starting",
      "Choose which browser opens",
    ],
    answer: [
      "--port overrides DASHBOARD_PORT; the default is 8000. Set the port to 0 to choose a free port automatically, for example spt dashboard --port 9000.",
      "On a server without a desktop, use --no-browser. To choose the browser, set BROWSER.",
    ],
    source: `${README} › Run`,
  },
  {
    id: "credentials",
    question: "Where do the S3 credentials come from?",
    alternates: [
      "Where do I enter my access key?",
      "How do I set the bucket?",
      "Can I type my secret key in the browser?",
    ],
    answer: [
      "SPT's storage target and credentials must be configured on the host; the dashboard does not accept credentials from the browser. The bucket and access keys always come from .env.",
      "CLI mode reads .env from the directory where you launch SPT and from your home directory, with environment variables taking precedence. The optional S3 endpoint in Storage configuration overrides the endpoint from .env.",
    ],
    source: `${README} › Run, Storage configuration`,
  },
  {
    id: "storage-locations",
    question: "Where are results and dashboard state stored?",
    alternates: ["Where is the results folder?", "Where are run logs saved?"],
    answer: [
      "Results are stored in ~/results on the host.",
      "Dashboard state (storage settings, the last job and run logs) is stored under your user configuration directory in spt/dashboard (~/.config/spt/dashboard on Linux).",
    ],
    source: `${README} › Run`,
  },
  {
    id: "results-catalog",
    question: "What is the Results catalog?",
    alternates: [
      "Find runs started from the SPT CLI",
      "Search old results",
      "Why is my run marked as partial or malformed?",
    ],
    answer: [
      "The Results catalog lists every SPT run found under the results root (~/results by default, or DASHBOARD_RESULTS_ROOT), both dashboard runs and runs started with the SPT CLI. It is read only. Search by name, label, object size or endpoint host, and open Details for settings, phase results, logs and downloads.",
      "A folder is a run when it holds spt_run_params.json or a results totals file. Malformed or partial folders are listed with what is missing instead of being hidden.",
    ],
    source: `${README} › Results catalog`,
  },
  {
    id: "compare-runs",
    question: "How do I compare runs?",
    alternates: [
      "Compare two benchmarks side by side",
      "Check a run against a baseline",
    ],
    answer: [
      "Select 2–6 runs in the Results catalog, choose a baseline, and choose Compare.",
      "The compare view overlays per-phase IOPS, bandwidth, P50 and P99 latency on a shared time axis, and shows a delta table per phase and metric against the baseline, with a flag on each delta.",
    ],
    source: `${README} › Compare runs and regression flags`,
  },
  {
    id: "regression-flags",
    question: "What do Regressed and Not comparable mean?",
    alternates: [
      "How are regressions flagged?",
      "What is the regression threshold?",
    ],
    answer: [
      "A metric is Regressed when it is worse than the baseline by more than the threshold (default 10%). This is a threshold check, not statistical significance. Latency changes under the latency floor (default 500 µs) and phases with fewer operations than the minimum (default 10) are not flagged.",
      "Any corrupt object is always flagged, and more failed operations than the baseline counts as a regression. Runs whose settings differ from the baseline (workload, object size, object count, threads, client machine count or S3 driver) are Not comparable. One run per side cannot show variance, so repeat runs before drawing conclusions.",
    ],
    source: `${README} › Compare runs and regression flags`,
  },
  {
    id: "connect-active-run",
    question: "How do I monitor a run started with the SPT CLI?",
    alternates: [
      "Connect to an active run",
      "Watch a run I launched from the terminal",
    ],
    answer: [
      "Use Connect to active run and choose the run's entry machine from the client machines saved under Storage configuration. For a local run use 127.0.0.1.",
      "The dashboard reads SPT's status and metrics on port 9999 while attached. The connection is read only: it does not launch or stop SPT. Disconnect returns the dashboard to its local state.",
    ],
    source: `${README} › Monitor an existing SPT run`,
  },
  {
    id: "run-logs",
    question: "Where can I see a run's errors and logs?",
    alternates: [
      "Show the error messages for my run",
      "View the console output",
    ],
    answer: [
      "The live dashboard has a collapsed Errors and logs panel, and Details in the Results catalog shows a run's logs. Both filter by level (All, WARN+, ERROR) and show at most the last 200 matching lines.",
      "While a run is active you see the dashboard-captured console output; afterwards the logs come from SPT's log files in the results folder. Values that look like credentials are redacted.",
    ],
    source: `${README} › Run logs`,
  },
  {
    id: "close-browser",
    question: "What happens if I close the browser or press Ctrl+C?",
    alternates: [
      "Does the run keep going if I close the tab?",
      "How do I shut down the dashboard?",
    ],
    answer: [
      "Keep the terminal open while using the dashboard. Closing the browser leaves the server and any active run running.",
      "Ctrl+C in the terminal stops the server and interrupts an active benchmark; the run is recorded as interrupted · by dashboard.",
    ],
    source: `${README} › Run`,
  },
];

const faqIndex = buildIndex(faq);

/** "Did you mean?" suggestions for what the user typed, best first. */
export function suggest(question: string): FaqEntry[] {
  return match(faqIndex, question, {
    topK: HELP_TOP_K,
    threshold: HELP_THRESHOLD,
  }).map((m) => m.entry);
}
