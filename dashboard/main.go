package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"embed"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// The browser UI ships inside the Go server binary.
//
//go:embed index.html
var assets embed.FS

const (
	maxObjects      = 100
	maxThreads      = 2
	maxRuntime      = 120
	maxRequestBytes = 4096
	maxCSVBytes     = 10_000_000
	maxLogBytes     = 2_000_000
	maxMetricsBytes = 1_000_000
	sptAPIPort      = 9999
	metricsContract = "SPT live metrics API"
)

var (
	objectCounts   = map[int]bool{10: true, 25: true, 50: true, 100: true}
	objectSizes    = map[string]bool{"64KiB": true, "256KiB": true, "1MiB": true}
	threadCounts   = map[int]bool{1: true, 2: true}
	runtimes       = map[int]bool{60: true, 120: true}
	namePattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{1,61}[A-Za-z0-9]$`)
	runPattern     = regexp.MustCompile(`^mt-[A-Za-z0-9_.-]+$`)
	keyPattern     = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	runTimePattern = regexp.MustCompile(`^mt-dashboard-(\d{8}T\d{6})-`)
)

type options struct {
	ObjectCount       int    `json:"object_count"`
	ObjectSize        string `json:"object_size"`
	Threads           int    `json:"threads"`
	MaxRuntimeSeconds int    `json:"max_runtime_seconds"`
}

type app struct {
	root       string
	home       string
	results    string
	stateDir   string
	stateFile  string
	lockFile   string
	port       string
	sptBin     string
	metricsURL string

	mu            sync.Mutex
	activeJob     map[string]any
	activeCmd     *exec.Cmd
	activeLock    *os.File
	liveRunID     string
	liveSamples   []map[string]any
	liveSignature string
}

func main() {
	if maxThreads > 4 || maxRuntime > 180 || maxObjects > 100 {
		log.Fatal("dashboard safety limits exceed the reviewed VM profile")
	}
	root, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	root = filepath.Dir(root)
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatal(err)
	}
	port := os.Getenv("DASHBOARD_PORT")
	if port == "" {
		port = "8000"
	}
	sptBin, _ := exec.LookPath("spt")
	if sptBin == "" {
		if executable("/usr/local/bin/spt") {
			sptBin = "/usr/local/bin/spt"
		}
	}
	stateDir := filepath.Join(root, ".dashboard-state")
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		log.Fatal(err)
	}
	_ = os.Chmod(stateDir, 0700)
	a := &app{root: root, home: home, results: filepath.Join(home, "results"), stateDir: stateDir,
		stateFile: filepath.Join(stateDir, "latest-job.json"), lockFile: filepath.Join(stateDir, "job.lock"), port: port, sptBin: sptBin}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", a.handleRoot)
	mux.HandleFunc("GET /index.html", a.handleRoot)
	mux.HandleFunc("GET /favicon.ico", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /api/state", a.handleState)
	mux.HandleFunc("GET /api/runs", a.handleRunHistory)
	mux.HandleFunc("GET /api/runs/{runID}/csv", a.handleRunCSV)
	mux.HandleFunc("GET /api/runs/{runID}", a.handleSavedRun)
	mux.HandleFunc("POST /api/runs", a.handleRun)
	server := &http.Server{Addr: "127.0.0.1:" + port, Handler: securityHeaders(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 * 1024}
	stop, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	go func() {
		<-stop.Done()
		ctx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = server.Shutdown(ctx)
	}()
	log.Printf("Dashboard listening on http://127.0.0.1:%s; SPT runs are single-node and bounded.", port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func executable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode()&0111 != 0
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-store")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func (a *app) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/index.html" {
		http.NotFound(w, r)
		return
	}
	body, err := assets.ReadFile("index.html")
	if err != nil {
		http.Error(w, "Dashboard page not found", 404)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	_, _ = w.Write(body)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		status = 500
		body = []byte(`{"error":"Could not encode dashboard response."}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func (a *app) handleState(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		writeJSON(w, 404, map[string]any{"error": "Endpoint not found."})
		return
	}
	state, err := a.currentState()
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "Could not read SPT state: " + err.Error()})
		return
	}
	writeJSON(w, 200, state)
}

func (a *app) handleRunHistory(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		writeJSON(w, 404, map[string]any{"error": "Endpoint not found."})
		return
	}
	entries, err := os.ReadDir(a.results)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		writeJSON(w, 500, map[string]any{"error": "Could not read saved SPT runs."})
		return
	}
	a.mu.Lock()
	latest := cloneMap(a.activeJob)
	a.mu.Unlock()
	if latest == nil {
		latest = a.readStateFile()
	}
	items := []map[string]any{}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "mt-dashboard-") || !runPattern.MatchString(entry.Name()) {
			continue
		}
		item, err := a.savedRun(entry.Name(), latest, false)
		if err == nil {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return str(items[i]["started_at"]) > str(items[j]["started_at"])
	})
	if len(items) > 200 {
		items = items[:200]
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": items})
}

func (a *app) handleSavedRun(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	if r.URL.RawQuery != "" || !runPattern.MatchString(runID) || filepath.Base(runID) != runID || !strings.HasPrefix(runID, "mt-dashboard-") {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Saved run not found."})
		return
	}
	a.mu.Lock()
	latest := cloneMap(a.activeJob)
	a.mu.Unlock()
	if latest == nil {
		latest = a.readStateFile()
	}
	item, err := a.savedRun(runID, latest, true)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Saved run not found."})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *app) handleRunCSV(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	query := r.URL.Query()
	for key := range query {
		if key != "kind" && key != "phase" && key != "start" && key != "end" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Unsupported CSV export options."})
			return
		}
	}
	if !runPattern.MatchString(runID) || filepath.Base(runID) != runID || !strings.HasPrefix(runID, "mt-dashboard-") {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Saved run not found."})
		return
	}
	item, err := a.savedRun(runID, nil, true)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Saved run not found."})
		return
	}
	metrics, _ := item["metrics"].(map[string]any)
	kind := query.Get("kind")
	if kind == "" {
		kind = "summary"
	}
	rows := []map[string]any{}
	phase := strings.ToUpper(query.Get("phase"))
	switch kind {
	case "summary":
		rows = metricsSummaries(metrics)
		if len(rows) == 0 && metrics != nil {
			rows, _ = metrics["chart_samples"].([]map[string]any)
		}
	case "samples":
		if metrics != nil {
			rows, _ = metrics["chart_samples"].([]map[string]any)
		}
	case "phase", "window":
		if phase != "CREATE" && phase != "VERIFY" && phase != "READ" && phase != "DELETE" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Choose a supported run phase."})
			return
		}
		if metrics != nil {
			all, _ := metrics["chart_samples"].([]map[string]any)
			started, _ := time.Parse(time.RFC3339Nano, str(item["job"].(map[string]any)["started_at"]))
			var min, max float64
			if kind == "window" {
				var e1, e2 error
				min, e1 = strconv.ParseFloat(query.Get("start"), 64)
				max, e2 = strconv.ParseFloat(query.Get("end"), 64)
				if e1 != nil || e2 != nil || math.IsNaN(min) || math.IsNaN(max) || math.IsInf(min, 0) || math.IsInf(max, 0) || min < 0 || max < min {
					writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Choose a valid visible time window."})
					return
				}
			}
			for _, row := range all {
				if phaseCodeForBackend(str(row["op_type"])) != phase {
					continue
				}
				if kind == "window" {
					t, e := time.Parse(time.RFC3339Nano, str(row["timestamp"]))
					if e != nil || started.IsZero() {
						continue
					}
					elapsed := t.Sub(started).Seconds()
					if elapsed < min || elapsed > max {
						continue
					}
				}
				rows = append(rows, row)
			}
		}
	default:
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Choose summary, samples, phase, or window CSV."})
		return
	}
	if len(rows) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "No measurements are available for this CSV export."})
		return
	}
	filename := "spt-" + runID + "-" + kind + ".csv"
	if phase != "" {
		filename = "spt-" + runID + "-" + strings.ToLower(phase) + "-" + kind + ".csv"
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	writer := csv.NewWriter(w)
	fields := map[string]bool{}
	for _, row := range rows {
		for key := range row {
			if keyPattern.MatchString(key) {
				fields[key] = true
			}
		}
	}
	columns := make([]string, 0, len(fields))
	for key := range fields {
		columns = append(columns, key)
	}
	sort.Strings(columns)
	_ = writer.Write(columns)
	for _, row := range rows {
		record := make([]string, len(columns))
		for i, key := range columns {
			if value := row[key]; value != nil {
				record[i] = fmt.Sprint(value)
			}
		}
		_ = writer.Write(record)
	}
	writer.Flush()
}

func phaseCodeForBackend(value string) string {
	s := strings.ToUpper(value)
	switch {
	case strings.Contains(s, "CREATE"), strings.Contains(s, "WRITE"):
		return "CREATE"
	case strings.Contains(s, "VERIFY"), strings.Contains(s, "READ"):
		return "VERIFY"
	case strings.Contains(s, "DELETE"), strings.Contains(s, "CLEANUP"):
		return "DELETE"
	default:
		return "SPT"
	}
}

func (a *app) savedRun(runID string, latest map[string]any, includeMetrics bool) (map[string]any, error) {
	dir := filepath.Join(a.results, runID)
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() || filepath.Dir(dir) != a.results {
		return nil, os.ErrNotExist
	}
	metrics := a.readRealRun(dir, runID, false)
	var params map[string]any
	for _, candidate := range []string{filepath.Join(dir, "spt_run_params.json")} {
		if b, e := os.ReadFile(candidate); e == nil {
			_ = json.Unmarshal(b, &params)
		}
	}
	if params == nil {
		children, _ := os.ReadDir(dir)
		for _, child := range children {
			if !child.IsDir() {
				continue
			}
			if b, e := os.ReadFile(filepath.Join(dir, child.Name(), "spt_run_params.json")); e == nil && json.Unmarshal(b, &params) == nil {
				break
			}
		}
	}
	if params == nil {
		return nil, os.ErrNotExist
	}

	startedAt := ""
	if match := runTimePattern.FindStringSubmatch(runID); len(match) == 2 {
		if stamp, e := time.ParseInLocation("20060102T150405", match[1], time.UTC); e == nil {
			startedAt = stamp.Format(time.RFC3339)
		}
	}
	if startedAt == "" {
		startedAt = str(params["generatedAt"])
	}
	scenario, _ := params["scenarioParams"].(map[string]any)
	options := map[string]any{
		"object_count":        scenario["ObjectCount"],
		"object_size":         scenario["ObjectSize"],
		"threads":             scenario["Threads"],
		"max_runtime_seconds": params["autoTerminateSeconds"],
	}
	status := "partial"
	if regularFile(filepath.Join(dir, "results_summary.txt")) || len(metricsSummaries(metrics)) >= 3 {
		status = "completed"
	}
	job := map[string]any{"run_id": runID, "status": status, "started_at": startedAt, "options": options}
	if latest != nil && str(latest["run_id"]) == runID {
		job = publicJob(latest)
		if opts, ok := latest["options"].(map[string]any); ok {
			options = opts
		}
		job["options"] = options
	}
	if metrics != nil {
		metrics["run_id"] = runID
	}
	item := map[string]any{"job": job, "metrics": metrics}
	if includeMetrics {
		item["target"] = a.targetConfiguration()
	} else {
		item = map[string]any{
			"run_id": runID, "started_at": startedAt, "status": status,
			"options": options, "phase_summaries": metricsSummaries(metrics),
		}
		if latest != nil && str(latest["run_id"]) == runID {
			item["status"] = str(latest["status"])
		}
	}
	return item, nil
}

func metricsSummaries(metrics map[string]any) []map[string]any {
	if metrics == nil {
		return []map[string]any{}
	}
	if rows, ok := metrics["phase_summaries"].([]map[string]any); ok {
		return rows
	}
	return []map[string]any{}
}

func (a *app) sameOrigin(r *http.Request) bool {
	host := strings.ToLower(r.Host)
	allowed := "localhost:" + a.port
	if host != "127.0.0.1:"+a.port && host != allowed {
		return false
	}
	origin := r.Header.Get("Origin")
	u, err := url.Parse(origin)
	return err == nil && u.Scheme == "http" && strings.ToLower(u.Host) == host && (u.Path == "" || u.Path == "/") && u.RawQuery == "" && u.Fragment == ""
}

func (a *app) handleRun(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/runs" || r.URL.RawQuery != "" {
		writeJSON(w, 404, map[string]any{"error": "Endpoint not found."})
		return
	}
	if !a.sameOrigin(r) {
		writeJSON(w, 403, map[string]any{"error": "Run requests must come from this dashboard through its SSH tunnel."})
		return
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeJSON(w, 415, map[string]any{"error": "Send JSON dashboard settings."})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var opts options
	if err := dec.Decode(&opts); err != nil {
		writeJSON(w, 400, map[string]any{"error": "Choose a supported object count, size, thread count, and maximum runtime."})
		return
	}
	if err := ensureEOF(dec); err != nil {
		writeJSON(w, 400, map[string]any{"error": "Send one JSON dashboard settings object."})
		return
	}
	if err := validateOptions(opts); err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	target := a.targetConfiguration()
	if target["ready"] != true {
		reasons, _ := target["reasons"].([]string)
		writeJSON(w, 503, map[string]any{"error": "SPT is not ready: " + strings.Join(reasons, " ")})
		return
	}
	a.mu.Lock()
	lock, err := a.lockRun()
	if err != nil {
		a.mu.Unlock()
		writeJSON(w, 409, map[string]any{"error": "An SPT dashboard run is already in progress. Wait for it to finish before starting another."})
		return
	}
	runID := "mt-dashboard-" + time.Now().UTC().Format("20060102T150405") + "-" + randomHex4()
	runDir := filepath.Join(a.results, runID)
	if filepath.Dir(runDir) != a.results {
		unlockClose(lock)
		a.mu.Unlock()
		writeJSON(w, 500, map[string]any{"error": "Could not allocate a unique SPT result directory."})
		return
	}
	if err := os.Mkdir(runDir, 0700); err != nil {
		unlockClose(lock)
		a.mu.Unlock()
		writeJSON(w, 500, map[string]any{"error": "Could not allocate a unique SPT result directory."})
		return
	}
	logPath := filepath.Join(a.stateDir, runID+".log")
	argv := a.buildArgv(runDir, runID, opts, target)
	cmd := exec.Command(a.sptBin, argv[1:]...)
	cmd.Dir = a.root
	cmd.Env = a.childEnvironment(opts, target)
	cmd.Stdin = nil
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = os.RemoveAll(runDir)
		unlockClose(lock)
		a.mu.Unlock()
		writeJSON(w, 500, map[string]any{"error": "Could not start SPT on the VM: " + err.Error()})
		return
	}
	cmd.Stderr = cmd.Stdout
	cmd.ExtraFiles = []*os.File{lock}
	if err = cmd.Start(); err != nil {
		_ = os.RemoveAll(runDir)
		unlockClose(lock)
		a.mu.Unlock()
		writeJSON(w, 500, map[string]any{"error": "Could not start SPT on the VM: " + err.Error()})
		return
	}
	drained := make(chan struct{})
	go func() { defer close(drained); drainOutput(stdout, logPath) }()
	started := time.Now().UTC()
	job := map[string]any{"run_id": runID, "status": "running", "created_at": started.Format(time.RFC3339Nano), "started_at": started.Format(time.RFC3339Nano), "started_epoch": float64(started.UnixNano()) / 1e9, "pid": cmd.Process.Pid, "returncode": nil, "options": opts, "prefix": "dashboard/" + runID + "/", "results_dir": runDir, "log_file": logPath, "message": "SPT write-and-verify job started on the Capstone VM.", "phase": "SPT setup"}
	a.activeJob = job
	a.activeCmd = cmd
	a.activeLock = lock
	a.liveRunID = ""
	a.liveSamples = nil
	a.liveSignature = ""
	if err := a.writeState(job); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		unlockClose(lock)
		a.activeCmd = nil
		a.activeLock = nil
		_ = os.RemoveAll(runDir)
		a.mu.Unlock()
		writeJSON(w, 500, map[string]any{"error": "Could not save dashboard run state."})
		return
	}
	a.mu.Unlock()
	go a.watchProcess(runID, cmd, lock, drained)
	go a.collectLiveHistory(runID, cmd)
	writeJSON(w, 202, map[string]any{"job": publicJob(job), "message": "SPT run started on the VM."})
}

func ensureEOF(dec *json.Decoder) error {
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("extra value")
		}
		return err
	}
	return nil
}

func validateOptions(o options) error {
	if !objectCounts[o.ObjectCount] {
		return errors.New("Object count is outside the dashboard's allowed choices.")
	}
	if !objectSizes[o.ObjectSize] {
		return errors.New("Object size is outside the dashboard's allowed choices.")
	}
	if !threadCounts[o.Threads] {
		return errors.New("Thread count is outside the dashboard's allowed choices.")
	}
	if !runtimes[o.MaxRuntimeSeconds] || o.MaxRuntimeSeconds > maxRuntime {
		return errors.New("Maximum runtime is outside the dashboard's allowed choices.")
	}
	return nil
}

func randomHex4() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(b[:])
}

func (a *app) lockRun() (*os.File, error) {
	f, err := os.OpenFile(a.lockFile, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}
func unlockClose(f *os.File) {
	if f != nil {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}
}

func (a *app) buildArgv(runDir, runID string, o options, target map[string]any) []string {
	return []string{a.sptBin, "run", "write-verify", "--headless", "--endpoints", fmt.Sprint(target["endpoint"]), "--bucket", fmt.Sprint(target["bucket"]), "--prefix", "dashboard/" + runID + "/", "--object-count", strconv.Itoa(o.ObjectCount), "--object-size", o.ObjectSize, "--threads", strconv.Itoa(o.Threads), "--test-hosts", "127.0.0.1", "--service-threads", strconv.Itoa(o.Threads), "--auto-terminate-seconds", strconv.Itoa(o.MaxRuntimeSeconds), "--s3-driver", "default", "--auth-version", "4", "--object-data-compressibility", "0", "--object-data-dedupable=true", "--cleanup", "--label", "dashboard", "--results-dir", runDir}
}

func (a *app) childEnvironment(o options, target map[string]any) []string {
	values := map[string]string{}
	for _, path := range []string{filepath.Join(a.home, ".env"), filepath.Join(a.root, ".env")} {
		for k, v := range readDotenv(path, values) {
			values[k] = v
		}
	}
	for _, item := range os.Environ() {
		if k, v, ok := strings.Cut(item, "="); ok {
			values[k] = v
		}
	}
	set := map[string]string{"S3_ENDPOINT": fmt.Sprint(target["endpoint"]), "S3_ENDPOINTS": fmt.Sprint(target["endpoint"]), "S3_BUCKET": fmt.Sprint(target["bucket"]), "HOSTS": "127.0.0.1", "THREADS": strconv.Itoa(o.Threads), "SPT_ENGINE_OVERRIDES": "", "SPT_SERVICE_THREADS": strconv.Itoa(o.Threads), "SPT_S3_DRIVER": "default", "SPT_IMAGE": "", "SPT_SKIP_IMAGE_PULL": "false", "SPT_OBJECT_DATA_COMPRESSIBILITY": "0", "SPT_OBJECT_DATA_DEDUPABLE": "true", "SPT_DEFER_VERIFICATION": "false", "SPT_CHECKSUM": "", "AWS_EC2_METADATA_DISABLED": "true"}
	for k, v := range set {
		values[k] = v
	}
	out := make([]string, 0, len(values))
	for k, v := range values {
		out = append(out, k+"="+v)
	}
	sort.Strings(out)
	return out
}

func readDotenv(path string, existing map[string]string) map[string]string {
	out := map[string]string{}
	f, err := os.Open(path)
	if err != nil {
		return out
	}
	defer f.Close()
	scan := bufio.NewScanner(io.LimitReader(f, 1_000_000))
	scan.Buffer(make([]byte, 4096), 1_000_000)
	for scan.Scan() {
		line := strings.TrimSpace(scan.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		if !keyPattern.MatchString(k) {
			continue
		}
		v = strings.TrimSpace(v)
		if len(v) >= 2 && ((v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'')) {
			v = v[1 : len(v)-1]
		} else if i := strings.Index(v, " #"); i >= 0 {
			v = strings.TrimSpace(v[:i])
		}
		out[k] = v
	}
	ref := regexp.MustCompile(`\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?`)
	for k, v := range out {
		out[k] = ref.ReplaceAllStringFunc(v, func(m string) string {
			n := strings.Trim(m, "$")
			n = strings.Trim(n, "{}")
			if x, ok := out[n]; ok {
				return x
			}
			if x, ok := existing[n]; ok {
				return x
			}
			return os.Getenv(n)
		})
	}
	return out
}

func (a *app) targetConfiguration() map[string]any {
	cfg := map[string]string{}
	for _, path := range []string{filepath.Join(a.home, ".env"), filepath.Join(a.root, ".env")} {
		for k, v := range readDotenv(path, cfg) {
			cfg[k] = v
		}
	}
	for _, item := range os.Environ() {
		if k, v, ok := strings.Cut(item, "="); ok {
			cfg[k] = v
		}
	}
	ep := cfg["S3_ENDPOINTS"]
	if ep == "" {
		ep = cfg["S3_ENDPOINT"]
	}
	endpoints := []string{}
	for _, x := range strings.Split(ep, ",") {
		if strings.TrimSpace(x) != "" {
			endpoints = append(endpoints, strings.TrimSpace(x))
		}
	}
	endpoint, label, bucket := "", "", strings.TrimSpace(cfg["S3_BUCKET"])
	reasons := []string{}
	if len(endpoints) != 1 {
		reasons = append(reasons, "Configure exactly one S3 endpoint in SPT on the VM.")
	} else {
		candidate := endpoints[0]
		u, err := url.Parse(candidate)
		if err != nil || strings.ToLower(u.Scheme) != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(candidate, " \t\r\n") {
			reasons = append(reasons, "The configured S3 endpoint must be a valid HTTPS URL without embedded credentials.")
		} else {
			endpoint = candidate
			label = u.Host
		}
	}
	if !namePattern.MatchString(bucket) {
		reasons = append(reasons, "Configure one valid S3 bucket name in SPT on the VM.")
	}
	creds := cfg["S3_ACCESS_KEY"] != "" && cfg["S3_SECRET_KEY"] != ""
	if !creds {
		reasons = append(reasons, "Configure S3_ACCESS_KEY and S3_SECRET_KEY in SPT on the VM.")
	}
	if !executable(a.sptBin) {
		reasons = append(reasons, "SPT is not executable on this VM.")
	}
	if _, err := exec.LookPath("docker"); err != nil {
		reasons = append(reasons, "Docker is not installed on this VM.")
	}
	return map[string]any{"ready": len(reasons) == 0, "reasons": reasons, "endpoint": endpoint, "endpoint_label": label, "bucket": bucket, "credentials_configured": creds}
}

func drainOutput(src io.Reader, path string) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		_, _ = io.Copy(io.Discard, src)
		return
	}
	defer f.Close()
	_, _ = io.Copy(io.MultiWriter(&limitedWriter{w: f, left: maxLogBytes}, io.Discard), src)
}

type limitedWriter struct {
	w    io.Writer
	left int64
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	n := len(p)
	if int64(n) > l.left {
		n = int(l.left)
	}
	if n > 0 {
		_, _ = l.w.Write(p[:n])
		l.left -= int64(n)
	}
	return len(p), nil
}

func (a *app) watchProcess(runID string, cmd *exec.Cmd, lock *os.File, drained <-chan struct{}) {
	<-drained
	err := cmd.Wait()
	code := 0
	status := "completed"
	message := "SPT finished successfully."
	if err != nil {
		status = "failed"
		message = "SPT exited with an error. See VM-side SPT logs for details."
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.activeJob != nil && a.activeJob["run_id"] == runID {
		a.activeJob = cloneMap(a.activeJob)
		a.activeJob["status"] = status
		a.activeJob["returncode"] = code
		a.activeJob["finished_at"] = utcNow()
		a.activeJob["message"] = message
		_ = a.writeState(a.activeJob)
		a.activeCmd = nil
		a.activeLock = nil
	}
	unlockClose(lock)
}

func cloneMap(src map[string]any) map[string]any {
	dst := make(map[string]any, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}
func utcNow() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func (a *app) readStateFile() map[string]any {
	b, e := os.ReadFile(a.stateFile)
	if e != nil {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return m
}
func (a *app) writeState(state map[string]any) error {
	b, e := json.Marshal(state)
	if e != nil {
		return e
	}
	tmp := a.stateFile + ".tmp"
	if e = os.WriteFile(tmp, b, 0600); e != nil {
		return e
	}
	if e = os.Chmod(tmp, 0600); e != nil {
		return e
	}
	return os.Rename(tmp, a.stateFile)
}

func publicJob(state map[string]any) map[string]any {
	keys := []string{"run_id", "status", "created_at", "started_at", "finished_at", "elapsed_seconds", "returncode", "message", "options", "prefix", "phase"}
	out := map[string]any{}
	for _, k := range keys {
		if v, ok := state[k]; ok {
			out[k] = v
		}
	}
	return out
}

func parseNumber(row map[string]string, keys ...string) (float64, bool) {
	for _, k := range keys {
		v := strings.TrimSpace(row[k])
		if v == "" {
			continue
		}
		n, e := strconv.ParseFloat(v, 64)
		if e == nil && !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n, true
		}
	}
	return 0, false
}
func optNumber(row map[string]string, keys ...string) any {
	if n, ok := parseNumber(row, keys...); ok {
		return n
	}
	return nil
}
func num(m map[string]any, key string) (float64, bool) {
	switch v := m[key].(type) {
	case float64:
		if !math.IsNaN(v) && !math.IsInf(v, 0) {
			return v, true
		}
	case int:
		return float64(v), true
	case json.Number:
		n, e := v.Float64()
		return n, e == nil
	case string:
		n, e := strconv.ParseFloat(v, 64)
		return n, e == nil && !math.IsNaN(n) && !math.IsInf(n, 0)
	}
	return 0, false
}
func str(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func mapValue(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}
func numberValue(m map[string]any, key string, def float64) float64 {
	if n, ok := num(m, key); ok {
		return n
	}
	return def
}

func (a *app) metricsFiles(runDir string, active bool) (string, bool) {
	entries, _ := os.ReadDir(runDir)
	paths := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.Contains(e.Name(), ".metrics") && strings.HasSuffix(e.Name(), ".csv") {
			paths = append(paths, filepath.Join(runDir, e.Name()))
		}
	}
	if len(paths) == 0 {
		return "", false
	}
	eligible := func(items []string) []string {
		create := []string{}
		pool := []string{}
		for _, p := range items {
			n := strings.ToLower(filepath.Base(p))
			if strings.Contains(n, "create") {
				create = append(create, p)
			}
			if !strings.Contains(n, "delete") && !strings.Contains(n, "cleanup") {
				pool = append(pool, p)
			}
		}
		if len(create) > 0 {
			return create
		}
		if len(pool) > 0 {
			return pool
		}
		return items
	}
	pool := []string{}
	aggregate := false
	for _, p := range paths {
		total := strings.HasSuffix(p, ".metrics.total.csv")
		if active && !total {
			pool = append(pool, p)
		}
		if !active && total {
			pool = append(pool, p)
		}
	}
	if !active && len(pool) > 0 {
		aggregate = true
	} else if !active {
		pool = nil
		for _, p := range paths {
			if !strings.HasSuffix(p, ".total.csv") {
				pool = append(pool, p)
			}
		}
	}
	pool = eligible(pool)
	if len(pool) == 0 {
		return "", false
	}
	sort.Slice(pool, func(i, j int) bool {
		a, _ := os.Stat(pool[i])
		b, _ := os.Stat(pool[j])
		if a == nil {
			return false
		}
		if b == nil {
			return true
		}
		return a.ModTime().After(b.ModTime())
	})
	return pool[0], aggregate
}

func (a *app) parseMetricsFile(path, runID, workload string, active, aggregate bool) (map[string]any, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxCSVBytes {
		return nil, errors.New("SPT metrics file exceeded the dashboard's 10 MB read limit.")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	reader := csv.NewReader(io.LimitReader(f, maxCSVBytes+1))
	reader.FieldsPerRecord = -1
	headers, err := reader.Read()
	if err != nil {
		return nil, err
	}
	samples := []map[string]any{}
	start := time.Time{}
	for {
		record, e := reader.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			continue
		}
		raw := map[string]string{}
		for i, h := range headers {
			if i < len(record) {
				raw[h] = record[i]
			}
		}
		tsraw := strings.TrimSpace(raw["DateTimeISO8601"])
		ts, te := parseTimestamp(tsraw)
		if te != nil {
			continue
		}
		if start.IsZero() {
			start = ts
		}
		succ, _ := parseNumber(raw, "CountSucc")
		failed, _ := parseNumber(raw, "CountFail")
		dur, _ := parseNumber(raw, "DurationSum[s]")
		conc, _ := parseNumber(raw, "ConcurrencyCurr")
		if succ == 0 && failed == 0 && dur == 0 && conc == 0 {
			continue
		}
		avg, ok := parseNumber(raw, "TPAvg[op/s]")
		if !ok {
			continue
		}
		measured := avg
		if !aggregate {
			if x, ok := parseNumber(raw, "TPLast[op/s]", "TPAvg[op/s]"); ok {
				measured = x
			}
		}
		bwKeys := []string{"BWAvg[MiB/s]"}
		if !aggregate {
			bwKeys = []string{"BWLast[MiB/s]", "BWAvg[MiB/s]"}
		}
		bw, bwok := parseNumber(raw, bwKeys...)
		if !bwok {
			continue
		}
		elapsed := 0.0
		if aggregate {
			elapsed, _ = parseNumber(raw, "StepDuration[s]")
		} else {
			elapsed = ts.Sub(start).Seconds()
		}
		p50 := optNumber(raw, "LatencyMed[us]", "LatencyQ_0.5[us]")
		samples = append(samples, map[string]any{"timestamp": ts.UTC().Format(time.RFC3339Nano), "elapsed_seconds": elapsed, "cumulative_ops": succ, "count_failed": failed, "average_iops": avg, "interval_iops": measured, "bandwidth_mib_s": bw, "p50_latency_us": p50, "op_type": strings.TrimSpace(raw["OpType"]), "duration_seconds": numberOr(raw, []string{"StepDuration[s]"}, 0), "bytes_processed": optNumber(raw, "Size"), "concurrency": optNumber(raw, "Concurrency"), "concurrency_mean": optNumber(raw, "ConcurrencyMean"), "node_count": optNumber(raw, "NodeCount"), "corrupt_ops": optNumber(raw, "CountCorrupt"), "latency_mean_us": optNumber(raw, "LatencyAvg[us]"), "latency_min_us": optNumber(raw, "LatencyMin[us]"), "latency_max_us": optNumber(raw, "LatencyMax[us]"), "latency_p99_us": optNumber(raw, "LatencyQ_0.99[us]")})
	}
	return map[string]any{"run_id": runID, "workload_type": workload, "source_file": filepath.Base(path), "updated_at": info.ModTime().UTC().Format(time.RFC3339Nano), "is_active": active, "is_aggregate": aggregate, "samples": samples}, nil
}

func numberOr(row map[string]string, keys []string, def float64) float64 {
	if v, ok := parseNumber(row, keys...); ok {
		return v
	}
	return def
}
func parseTimestamp(v string) (time.Time, error) {
	v = strings.ReplaceAll(v, ",", ".")
	if t, e := time.Parse(time.RFC3339Nano, v); e == nil {
		return t, nil
	}
	for _, layout := range []string{"2006-01-02 15:04:05.999999999Z07:00", "2006-01-02 15:04:05.999999999", "2006-01-02T15:04:05.999999999"} {
		if t, e := time.Parse(layout, v); e == nil {
			return t, nil
		}
	}
	return time.Time{}, errors.New("bad timestamp")
}

func (a *app) readRealRun(runDir, runID string, active bool) map[string]any {
	abs, _ := filepath.Abs(runDir)
	root, _ := filepath.Abs(a.results)
	parent := filepath.Dir(abs)
	if parent != root {
		return nil
	}
	info, e := os.Stat(abs)
	if e != nil || !info.IsDir() {
		return nil
	}
	folders := []string{}
	if regularFile(filepath.Join(abs, "spt_run_params.json")) {
		folders = append(folders, abs)
	} else {
		entries, _ := os.ReadDir(abs)
		for _, item := range entries {
			if !item.IsDir() {
				continue
			}
			child := filepath.Join(abs, item.Name())
			if regularFile(filepath.Join(child, "spt_run_params.json")) {
				folders = append(folders, child)
			}
		}
	}
	sort.Slice(folders, func(i, j int) bool {
		a, _ := os.Stat(folders[i])
		b, _ := os.Stat(folders[j])
		return a != nil && b != nil && a.ModTime().After(b.ModTime())
	})
	for _, folder := range folders {
		b, err := os.ReadFile(filepath.Join(folder, "spt_run_params.json"))
		if err != nil {
			continue
		}
		var params map[string]any
		if json.Unmarshal(b, &params) != nil {
			continue
		}
		workload := strings.ToLower(strings.TrimSpace(str(params["workloadType"])))
		if workload == "" {
			workload = strings.ToLower(strings.TrimSpace(str(params["workload"])))
		}
		if workload == "" || workload == "mock" {
			continue
		}
		path, aggregate := a.metricsFiles(folder, active)
		if path == "" {
			continue
		}
		result, err := a.parseMetricsFile(path, filepath.Base(folder), workload, active, aggregate)
		if err != nil {
			continue
		}
		result["run_id"] = runID
		history := map[string][]map[string]any{}
		files, _ := filepath.Glob(filepath.Join(folder, "*.metrics.csv"))
		sort.Strings(files)
		for _, p := range files {
			part, err := a.parseMetricsFile(p, filepath.Base(folder), workload, active, false)
			if err != nil {
				continue
			}
			for _, sample := range part["samples"].([]map[string]any) {
				phase := strings.ToUpper(str(sample["op_type"]))
				if validPhase(phase) {
					history[phase] = append(history[phase], sample)
				}
			}
		}
		captured := map[string][]map[string]any{}
		for _, sample := range a.savedLiveSamples(runID) {
			phase := strings.ToUpper(str(sample["op_type"]))
			if validPhase(phase) {
				captured[phase] = append(captured[phase], sample)
			}
		}
		for phase, samples := range captured {
			if len(samples) > len(history[phase]) {
				history[phase] = samples
			}
		}
		chart := []map[string]any{}
		for _, samples := range history {
			chart = append(chart, samples...)
		}
		sort.Slice(chart, func(i, j int) bool { return str(chart[i]["timestamp"]) < str(chart[j]["timestamp"]) })
		if len(chart) > 100 {
			chart = chart[len(chart)-100:]
		}
		result["chart_samples"] = chart
		if !active {
			totals, _ := filepath.Glob(filepath.Join(folder, "*.metrics.total.csv"))
			sort.Strings(totals)
			summaries := []map[string]any{}
			for _, p := range totals {
				low := strings.ToLower(filepath.Base(p))
				phase := "SPT"
				for _, name := range []string{"create", "verify", "delete"} {
					if strings.Contains(low, name) {
						phase = strings.Title(name)
						break
					}
				}
				data, err := a.parseMetricsFile(p, filepath.Base(folder), workload, false, true)
				if err != nil {
					continue
				}
				rows := data["samples"].([]map[string]any)
				if len(rows) == 0 {
					continue
				}
				s := rows[len(rows)-1]
				item := map[string]any{"phase": phase, "source_file": filepath.Base(p), "successful_ops": s["cumulative_ops"], "failed_ops": s["count_failed"], "iops": s["interval_iops"], "bandwidth_mib_s": s["bandwidth_mib_s"], "p50_latency_us": s["p50_latency_us"]}
				for _, k := range []string{"timestamp", "duration_seconds", "bytes_processed", "concurrency", "concurrency_mean", "node_count", "corrupt_ops", "latency_mean_us", "latency_min_us", "latency_max_us", "latency_p99_us"} {
					item[k] = s[k]
				}
				summaries = append(summaries, item)
			}
			result["phase_summaries"] = summaries
			failed := 0.0
			all := len(summaries) > 0
			for _, s := range summaries {
				v, ok := num(s, "failed_ops")
				if !ok {
					all = false
					break
				}
				failed += v
			}
			if all {
				result["total_failed"] = failed
			} else {
				result["total_failed"] = nil
			}
		}
		return result
	}
	return nil
}
func validPhase(p string) bool { return p == "CREATE" || p == "VERIFY" || p == "READ" || p == "DELETE" }

func (a *app) savedLiveSamples(runID string) []map[string]any {
	if !runPattern.MatchString(runID) {
		return nil
	}
	path := filepath.Join(a.stateDir, runID+".samples.json")
	info, e := os.Stat(path)
	if e != nil || info.Size() > maxMetricsBytes {
		return nil
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return nil
	}
	var list []map[string]any
	if json.Unmarshal(b, &list) != nil {
		return nil
	}
	if len(list) > 100 {
		list = list[len(list)-100:]
	}
	out := []map[string]any{}
	for _, m := range list {
		if _, ok := m["timestamp"].(string); ok {
			out = append(out, m)
		}
	}
	return out
}

func (a *app) rememberLive(metrics map[string]any) map[string]any {
	runID := str(metrics["run_id"])
	if a.liveRunID != runID {
		a.liveRunID = runID
		a.liveSamples = a.savedLiveSamples(runID)
		a.liveSignature = ""
	}
	changed := false
	for _, raw := range metrics["samples"].([]map[string]any) {
		keys := []string{"step_id", "cumulative_ops", "count_failed", "interval_iops", "bandwidth_mib_s", "p50_latency_us"}
		vals := make([]any, 0, len(keys))
		for _, k := range keys {
			vals = append(vals, raw[k])
		}
		b, _ := json.Marshal(vals)
		sig := string(b)
		if sig != a.liveSignature {
			a.liveSamples = append(a.liveSamples, raw)
			if len(a.liveSamples) > 100 {
				a.liveSamples = a.liveSamples[len(a.liveSamples)-100:]
			}
			a.liveSignature = sig
			changed = true
		}
	}
	if changed && runPattern.MatchString(runID) {
		b, _ := json.Marshal(a.liveSamples)
		tmp := filepath.Join(a.stateDir, runID+".samples.tmp")
		path := filepath.Join(a.stateDir, runID+".samples.json")
		if os.WriteFile(tmp, b, 0600) == nil {
			_ = os.Chmod(tmp, 0600)
			_ = os.Rename(tmp, path)
		}
	}
	out := cloneMap(metrics)
	out["samples"] = append([]map[string]any(nil), a.liveSamples...)
	out["chart_samples"] = append([]map[string]any(nil), a.liveSamples...)
	return out
}

func (a *app) liveMetrics(state map[string]any) map[string]any {
	started, ok := num(state, "started_epoch")
	if !ok {
		return nil
	}
	client := &http.Client{Timeout: 450 * time.Millisecond}
	metricsURL := a.metricsURL
	if metricsURL == "" {
		metricsURL = fmt.Sprintf("http://127.0.0.1:%d/metrics/json", sptAPIPort)
	}
	req, _ := http.NewRequest(http.MethodGet, metricsURL, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxMetricsBytes+1))
	if err != nil || len(body) > maxMetricsBytes || resp.StatusCode != 200 {
		return nil
	}
	var payload any
	if json.Unmarshal(body, &payload) != nil {
		return nil
	}
	entries := []any{}
	if list, ok := payload.([]any); ok {
		entries = list
	} else {
		entries = append(entries, payload)
	}
	fresh := []map[string]any{}
	for _, item := range entries {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		t, err := parseTimestamp(str(m["sample_ts"]))
		if err != nil {
			continue
		}
		stateN := numberValue(m, "test_state", 0)
		step := str(m["step_id"])
		if float64(t.UnixNano())/1e9 < started || stateN != 1 || m["terminal"] == true || step == "" {
			continue
		}
		fresh = append(fresh, m)
	}
	if len(fresh) == 0 {
		return nil
	}
	sort.Slice(fresh, func(i, j int) bool { return str(fresh[i]["sample_ts"]) > str(fresh[j]["sample_ts"]) })
	entry := map[string]any(nil)
	for _, m := range fresh {
		if m["scope"] == "fleet" || m["scope"] == "cluster" {
			entry = m
			break
		}
	}
	if entry == nil {
		for _, m := range fresh {
			if m["role"] == "entry" {
				entry = m
				break
			}
		}
	}
	if entry == nil {
		entry = fresh[0]
	}
	ops := mapValue(entry["operations"])
	bandwidth := mapValue(entry["bandwidth"])
	timing := mapValue(entry["timing"])
	latency := mapValue(timing["latency"])
	success := numberValue(ops, "success_count", 0)
	failed := numberValue(ops, "failed_count", 0)
	elapsed := numberValue(entry, "elapsed_time_seconds", 0)
	bytesTotal := numberValue(bandwidth, "bytes_total", 0)
	iops, iok := num(ops, "success_rate_last")
	if !iok && elapsed > 0 {
		iops = success / elapsed
		iok = true
	}
	byteRate, bok := num(bandwidth, "bytes_rate_last")
	if !bok && elapsed > 0 {
		byteRate = bytesTotal / elapsed
		bok = true
	}
	var bw any
	if bok {
		bw = byteRate / (1024 * 1024)
	}
	var p50 any
	if numberValue(latency, "count", 0) > 0 {
		if measuredP50, ok := num(latency, "p50_us"); ok {
			p50 = measuredP50
		}
	}
	ts, err := parseTimestamp(str(entry["sample_ts"]))
	if err != nil {
		return nil
	}
	stepElapsed := math.Max(0, float64(ts.UnixNano())/1e9-started)
	var iopsAny any
	if iok {
		iopsAny = iops
	}
	sample := map[string]any{"timestamp": ts.UTC().Format(time.RFC3339Nano), "elapsed_seconds": stepElapsed, "cumulative_ops": success, "count_failed": failed, "average_iops": any(nil), "interval_iops": iopsAny, "bandwidth_mib_s": bw, "bandwidth_unit": "MiB/s", "source_file": metricsContract, "p50_latency_us": p50, "step_id": str(entry["step_id"]), "op_type": str(entry["op_type"]), "completion_percent": optionalMetric(entry, "completion_percent")}
	if elapsed > 0 {
		sample["average_iops"] = success / elapsed
	}
	has := success > 0 || failed > 0 || numberValue(latency, "count", 0) > 0 || bytesTotal > 0
	out := map[string]any{"run_id": str(state["run_id"]), "workload_type": "write-verify", "source_file": metricsContract, "updated_at": sample["timestamp"], "is_active": true, "is_aggregate": false, "phase": firstNonempty(str(sample["op_type"]), str(sample["step_id"])), "phase_id": str(sample["step_id"]), "progress_percent": sample["completion_percent"], "samples": []map[string]any{}}
	if !has {
		return out
	}
	out["samples"] = []map[string]any{sample}
	return out
}
func optionalMetric(m map[string]any, key string) any {
	if v, ok := num(m, key); ok {
		return v
	}
	return nil
}
func firstNonempty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func (a *app) collectLiveHistory(runID string, cmd *exec.Cmd) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		a.mu.Lock()
		if a.activeJob == nil || a.activeJob["run_id"] != runID || a.activeJob["status"] != "running" {
			a.mu.Unlock()
			return
		}
		state := cloneMap(a.activeJob)
		a.mu.Unlock()
		if metrics := a.liveMetrics(state); metrics != nil {
			a.mu.Lock()
			if a.activeJob != nil && a.activeJob["run_id"] == runID {
				_ = a.rememberLive(metrics)
			}
			a.mu.Unlock()
		}
		<-ticker.C
	}
}

func (a *app) currentState() (map[string]any, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	state := a.activeJob
	// Recover completed runs too, so a service restart preserves their public
	// settings, timestamps, and outcome alongside the saved measurements.
	if state == nil && !a.lockBusy() {
		state = a.readStateFile()
		if state != nil {
			a.activeJob = state
		}
	}
	if state == nil && a.lockBusy() {
		state = a.readStateFile()
		if state != nil {
			a.activeJob = state
			state["status"] = "running"
			if epoch, ok := num(state, "started_epoch"); ok {
				state["elapsed_seconds"] = int(time.Now().Unix() - int64(epoch))
			}
		}
	}
	if state != nil && str(state["status"]) == "running" && a.activeCmd == nil && !a.lockBusy() {
		state = cloneMap(state)
		state["status"] = "unknown"
		state["message"] = "The dashboard restarted before it could record SPT's final exit status."
		_ = a.writeState(state)
		a.activeJob = state
	}
	if state != nil && str(state["status"]) == "running" {
		state = cloneMap(state)
		if epoch, ok := num(state, "started_epoch"); ok {
			state["elapsed_seconds"] = math.Max(0, float64(time.Now().Unix())-epoch)
		}
		state["phase"] = a.phaseFromOutput(str(state["results_dir"]))
		result := a.readRealRun(str(state["results_dir"]), str(state["run_id"]), true)
		live := a.liveMetrics(state)
		if live != nil {
			result = a.rememberLive(live)
			phase := strings.ToLower(str(live["phase"]))
			label := "Create / write"
			if strings.Contains(phase, "verify") || strings.Contains(phase, "read") {
				label = "Verify"
			}
			if strings.Contains(phase, "delete") || strings.Contains(phase, "cleanup") {
				label = "Cleanup"
			}
			state["phase"] = label
			ss := live["samples"].([]map[string]any)
			if len(ss) > 0 {
				sample := ss[0]
				state["message"] = fmt.Sprintf("SPT live %s metrics: %.0f successful, %.0f failed operations.", strings.ToLower(label), numberValue(sample, "cumulative_ops", 0), numberValue(sample, "count_failed", 0))
			} else {
				state["message"] = "SPT is in the " + strings.ToLower(label) + " phase; waiting for its first measured operation."
			}
			_ = a.writeState(state)
		} else {
			retained := retainedLiveMetrics(str(state["run_id"]), a.liveRunID, a.liveSamples)
			if result == nil {
				if retained != nil {
					result = retained
					result["source_file"] = "Last SPT live metrics · waiting for next phase"
					state["phase"] = "Finalizing results"
					state["message"] = "SPT is moving between phases; the last recorded measurements remain visible."
					_ = a.writeState(state)
				} else {
					result = map[string]any{"run_id": state["run_id"], "workload_type": "write-verify", "source_file": "Waiting for SPT live metrics", "updated_at": utcNow(), "is_active": true, "is_aggregate": false, "samples": []map[string]any{}, "chart_samples": []map[string]any{}}
				}
			} else {
				result["is_active"] = true
				result["is_aggregate"] = false
				chart, _ := result["chart_samples"].([]map[string]any)
				if len(chart) == 0 && retained != nil {
					result["chart_samples"] = retained["chart_samples"]
					if len(result["samples"].([]map[string]any)) == 0 {
						result["samples"] = retained["samples"]
					}
					result["source_file"] = "Last SPT live metrics · waiting for next phase"
					state["phase"] = "Finalizing results"
					state["message"] = "SPT is moving between phases; the last recorded measurements remain visible."
					_ = a.writeState(state)
				}
			}
		}
		a.activeJob = state
		return map[string]any{"job": publicJob(state), "metrics": result, "target": a.targetConfiguration()}, nil
	}
	if state != nil && str(state["status"]) == "running" && !a.lockBusy() {
		state = a.readStateFile()
		if state == nil {
			state = a.activeJob
		}
		if state != nil {
			state["status"] = "unknown"
			state["message"] = "The dashboard restarted before it could record SPT's final exit status."
			_ = a.writeState(state)
			a.activeJob = state
		}
	}
	if state != nil {
		return map[string]any{"job": publicJob(state), "metrics": a.readRealRun(str(state["results_dir"]), str(state["run_id"]), false), "target": a.targetConfiguration()}, nil
	}
	return map[string]any{"job": nil, "metrics": a.latestSavedRun(), "target": a.targetConfiguration()}, nil
}

func retainedLiveMetrics(runID, liveRunID string, samples []map[string]any) map[string]any {
	if runID == "" || runID != liveRunID || len(samples) == 0 {
		return nil
	}
	copy := append([]map[string]any(nil), samples...)
	return map[string]any{
		"run_id": runID, "workload_type": "write-verify", "updated_at": copy[len(copy)-1]["timestamp"],
		"is_active": true, "is_aggregate": false, "samples": copy,
		"chart_samples": append([]map[string]any(nil), copy...),
	}
}

func (a *app) lockBusy() bool {
	f, e := os.OpenFile(a.lockFile, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return false
	}
	defer f.Close()
	if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return true
	}
	_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return false
}
func (a *app) latestSavedRun() map[string]any {
	entries, e := os.ReadDir(a.results)
	if e != nil {
		return nil
	}
	dirs := []string{}
	for _, ent := range entries {
		if ent.IsDir() && strings.HasPrefix(ent.Name(), "mt-") {
			dirs = append(dirs, filepath.Join(a.results, ent.Name()))
		}
	}
	sort.Slice(dirs, func(i, j int) bool {
		x, _ := os.Stat(dirs[i])
		y, _ := os.Stat(dirs[j])
		return x != nil && y != nil && x.ModTime().After(y.ModTime())
	})
	if len(dirs) > 200 {
		dirs = dirs[:200]
	}
	for _, dir := range dirs {
		r := a.readRealRun(dir, filepath.Base(dir), false)
		if r != nil && len(r["samples"].([]map[string]any)) > 0 {
			return r
		}
	}
	return nil
}

func (a *app) phaseFromOutput(runDir string) string {
	files := []string{}
	_ = filepath.WalkDir(runDir, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(path, ".metrics.csv") && !strings.HasSuffix(path, ".total.csv") {
			files = append(files, path)
		}
		return nil
	})
	if len(files) == 0 {
		return "SPT setup"
	}
	sort.Slice(files, func(i, j int) bool {
		x, _ := os.Stat(files[i])
		y, _ := os.Stat(files[j])
		return x != nil && y != nil && x.ModTime().After(y.ModTime())
	})
	name := strings.ToLower(filepath.Base(files[0]))
	if strings.Contains(name, "delete") || strings.Contains(name, "cleanup") {
		return "Cleanup"
	}
	if strings.Contains(name, "verify") || strings.Contains(name, "read") {
		return "Verify"
	}
	if strings.Contains(name, "create") || strings.Contains(name, "write") {
		return "Create / write"
	}
	return "SPT metrics"
}
func regularFile(path string) bool {
	info, e := os.Stat(path)
	return e == nil && info.Mode().IsRegular()
}
