package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxHosts        = 8
	verifyTimeout   = 5 * time.Minute
	endpointTimeout = 5 * time.Second
	localHost       = "127.0.0.1"
)

var (
	userPattern      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]{0,31}$`)
	hostLabelPattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$`)

	// Line shapes printed by `spt verify`; it has no machine-readable output.
	verifyDonePattern    = regexp.MustCompile(`^\s*(✅|❌)\s+(\S+) verification (?:complete|failed)(?: \((.*)\))?\s*$`)
	verifyNodePattern    = regexp.MustCompile(`^Node:\s+(\S+)\s*$`)
	verifyCheckPattern   = regexp.MustCompile(`^\s*(?:✓|✗|⚠)\s+(.+?):\s+(PASS|FAIL|WARN) - (.*)$`)
	verifyOverallPattern = regexp.MustCompile(`^\s*Overall:\s+(✅|❌)\s*(.*)$`)
	verifySummaryPattern = regexp.MustCompile(`^(?:✅ READY|❌ NOT READY):\s*(.*)$`)
)

// storageConfig is the part of the target the browser may set. The bucket and
// credentials stay in the host's .env files.
type storageConfig struct {
	Hosts    []string `json:"hosts"`
	Endpoint string   `json:"endpoint"`
}

type verifyCheck struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

type verifyNode struct {
	Host    string        `json:"host"`
	Status  string        `json:"status"`
	Message string        `json:"message"`
	Checks  []verifyCheck `json:"checks"`
}

type verifyEndpoint struct {
	Label   string `json:"label"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

type verification struct {
	Status     string         `json:"status"`
	Signature  string         `json:"config_signature,omitempty"`
	StartedAt  string         `json:"started_at,omitempty"`
	FinishedAt string         `json:"finished_at,omitempty"`
	Summary    string         `json:"summary"`
	Nodes      []verifyNode   `json:"nodes"`
	Endpoint   verifyEndpoint `json:"endpoint"`
}

func (n verifyNode) clone() verifyNode {
	n.Checks = append([]verifyCheck{}, n.Checks...)
	return n
}

func (v verification) clone() verification {
	nodes := make([]verifyNode, len(v.Nodes))
	for i, n := range v.Nodes {
		nodes[i] = n.clone()
	}
	v.Nodes = nodes
	return v
}

// hostAddress returns the address part of a [user@]host entry, as SPT reports it.
func hostAddress(entry string) string {
	host := entry
	if i := strings.LastIndex(entry, "@"); i >= 0 {
		host = entry[i+1:]
	}
	if host == "localhost" {
		return localHost
	}
	return host
}

// validateHostEntry mirrors SPT's own --test-hosts rules. They also guarantee an
// entry can never start with "-" and be read as a command-line option.
func validateHostEntry(entry string) error {
	host := entry
	if i := strings.LastIndex(entry, "@"); i >= 0 {
		if !userPattern.MatchString(entry[:i]) {
			return errors.New("the user name is not valid")
		}
		host = entry[i+1:]
	}
	if net.ParseIP(host) != nil {
		return nil
	}
	if len(host) == 0 || len(host) > 253 {
		return errors.New("the host name is not valid")
	}
	for _, label := range strings.Split(strings.TrimSuffix(host, "."), ".") {
		if !hostLabelPattern.MatchString(label) {
			return errors.New("the host name is not valid")
		}
	}
	return nil
}

func validateEndpoint(candidate string) (endpoint, label string, ok bool) {
	u, err := url.Parse(candidate)
	if err != nil || strings.ToLower(u.Scheme) != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(candidate, " \t\r\n") {
		return "", "", false
	}
	return candidate, u.Host, true
}

func validateStorage(c storageConfig) (storageConfig, error) {
	out := storageConfig{Hosts: []string{}, Endpoint: strings.TrimSpace(c.Endpoint)}
	seen := map[string]bool{}
	for _, raw := range c.Hosts {
		entry := strings.TrimSpace(raw)
		if entry == "" {
			continue
		}
		if len(out.Hosts) == maxHosts {
			return out, fmt.Errorf("List at most %d client machines.", maxHosts)
		}
		if err := validateHostEntry(entry); err != nil {
			return out, fmt.Errorf("Client machine %q cannot be used: %v. Enter a host or user@host.", entry, err)
		}
		key := strings.ToLower(hostAddress(entry))
		if seen[key] {
			return out, fmt.Errorf("Client machine %q is listed more than once.", hostAddress(entry))
		}
		seen[key] = true
		out.Hosts = append(out.Hosts, entry)
	}
	if len(out.Hosts) == 0 {
		return out, errors.New("Add at least one client machine.")
	}
	if out.Endpoint != "" {
		if _, _, ok := validateEndpoint(out.Endpoint); !ok {
			return out, errors.New("The S3 endpoint must be a valid HTTPS URL without embedded credentials.")
		}
	}
	return out, nil
}

func configSignature(hosts []string, endpoint string) string {
	sum := sha256.Sum256([]byte(strings.Join(hosts, ",") + "\n" + endpoint))
	return hex.EncodeToString(sum[:])
}

func writeFileAtomic(path string, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	tmp := path + ".tmp"
	if e = os.WriteFile(tmp, b, 0600); e != nil {
		return e
	}
	if e = os.Chmod(tmp, 0600); e != nil {
		return e
	}
	return os.Rename(tmp, path)
}

func envList(values map[string]string) []string {
	out := make([]string, 0, len(values))
	for k, v := range values {
		out = append(out, k+"="+v)
	}
	sort.Strings(out)
	return out
}

// configValues merges the host's .env files with the process environment, which wins.
func (a *app) configValues() map[string]string {
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
	return values
}

func (a *app) storageSnapshot() storageConfig {
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	hosts := append([]string{}, a.storage.Hosts...)
	if len(hosts) == 0 {
		hosts = []string{localHost}
	}
	return storageConfig{Hosts: hosts, Endpoint: a.storage.Endpoint}
}

// loadStorage restores the saved client machines, endpoint, and last verification.
func (a *app) loadStorage() {
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	if b, e := os.ReadFile(a.storageFile); e == nil {
		var saved storageConfig
		if json.Unmarshal(b, &saved) == nil {
			if cfg, err := validateStorage(saved); err == nil {
				a.storage = cfg
			}
		}
	}
	if b, e := os.ReadFile(a.verifyFile); e == nil {
		var saved verification
		if json.Unmarshal(b, &saved) == nil {
			if saved.Status == "running" {
				saved.Status = "failed"
				saved.Summary = "The dashboard restarted before verification finished."
			}
			a.verification = saved
		}
	}
}

func (a *app) updateVerification(change func(*verification)) {
	a.storageMu.Lock()
	defer a.storageMu.Unlock()
	change(&a.verification)
}

// currentVerification returns the last verification, or an idle one when it no
// longer describes the configuration a run would use.
func (a *app) currentVerification(target map[string]any) verification {
	hosts, _ := target["hosts"].([]string)
	a.storageMu.Lock()
	v := a.verification.clone()
	a.storageMu.Unlock()
	if v.Status == "" || v.Signature != configSignature(hosts, str(target["endpoint"])) {
		return verification{Status: "idle", Nodes: []verifyNode{}}
	}
	return v
}

func (a *app) verified(target map[string]any) bool {
	return a.currentVerification(target).Status == "passed"
}

func (a *app) storageState(target map[string]any) map[string]any {
	cfg := a.storageSnapshot()
	return map[string]any{"hosts": cfg.Hosts, "endpoint": cfg.Endpoint, "max_hosts": maxHosts, "verification": a.currentVerification(target)}
}

func targetHosts(target map[string]any) string {
	hosts, _ := target["hosts"].([]string)
	if len(hosts) == 0 {
		return localHost
	}
	return strings.Join(hosts, ",")
}

// metricsEndpoint is SPT's live metrics API, served by the entry node (the first client machine).
func (a *app) metricsEndpoint() string {
	entry := hostAddress(a.storageSnapshot().Hosts[0])
	return "http://" + net.JoinHostPort(entry, strconv.Itoa(sptAPIPort)) + "/metrics/json"
}

func (a *app) handleVerify(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		writeJSON(w, 404, map[string]any{"error": "Endpoint not found."})
		return
	}
	if !a.sameOrigin(r) {
		writeJSON(w, 403, map[string]any{"error": "Verification requests must come from this dashboard through its SSH tunnel."})
		return
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeJSON(w, 415, map[string]any{"error": "Send JSON storage settings."})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var requested storageConfig
	if err := dec.Decode(&requested); err != nil {
		writeJSON(w, 400, map[string]any{"error": "Send the client machines and an optional S3 endpoint."})
		return
	}
	if err := ensureEOF(dec); err != nil {
		writeJSON(w, 400, map[string]any{"error": "Send one JSON storage settings object."})
		return
	}
	cfg, err := validateStorage(requested)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	if !executable(a.sptBin) {
		writeJSON(w, 503, map[string]any{"error": "SPT is not executable on this VM."})
		return
	}
	// Verification starts SPT containers on the ports a run uses, so the two never overlap.
	a.mu.Lock()
	busy := a.verifying
	if !busy {
		lock, lockErr := a.lockRun()
		busy = lockErr != nil
		unlockClose(lock)
	}
	if busy {
		a.mu.Unlock()
		writeJSON(w, 409, map[string]any{"error": "A run or verification is already in progress. Wait for it to finish first."})
		return
	}
	a.verifying = true
	a.mu.Unlock()

	if err := writeFileAtomic(a.storageFile, cfg); err != nil {
		a.mu.Lock()
		a.verifying = false
		a.mu.Unlock()
		writeJSON(w, 500, map[string]any{"error": "Could not save the storage configuration."})
		return
	}
	a.storageMu.Lock()
	a.storage = cfg
	a.storageMu.Unlock()

	target := a.targetConfiguration()
	endpoint := str(target["endpoint"])
	nodes := make([]verifyNode, len(cfg.Hosts))
	for i, host := range cfg.Hosts {
		nodes[i] = verifyNode{Host: host, Status: "pending", Checks: []verifyCheck{}}
	}
	a.updateVerification(func(v *verification) {
		*v = verification{Status: "running", Signature: configSignature(cfg.Hosts, endpoint), StartedAt: utcNow(), Nodes: nodes,
			Endpoint: verifyEndpoint{Label: str(target["endpoint_label"]), Status: "pending"}}
	})
	go a.runVerification(cfg.Hosts, endpoint)
	writeJSON(w, 202, map[string]any{"storage": a.storageState(target)})
}

func (a *app) runVerification(hosts []string, endpoint string) {
	defer func() {
		a.mu.Lock()
		a.verifying = false
		a.mu.Unlock()
	}()
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		status, message := "failed", "No valid S3 endpoint is configured."
		if endpoint != "" {
			status, message = checkEndpoint(a.endpointClient, endpoint)
		}
		a.updateVerification(func(v *verification) {
			v.Endpoint.Status = status
			v.Endpoint.Message = message
		})
	}()
	summary, err := a.runSptVerify(hosts)
	wg.Wait()

	a.updateVerification(func(v *verification) {
		passed := err == nil && v.Endpoint.Status == "passed"
		for i := range v.Nodes {
			if v.Nodes[i].Status == "pending" {
				v.Nodes[i].Status = "failed"
				v.Nodes[i].Message = "SPT did not report a result for this machine."
			}
			if v.Nodes[i].Status != "passed" {
				passed = false
			}
		}
		v.Status = "failed"
		v.Summary = firstNonempty(summary, "Verification did not pass.")
		if err != nil && summary == "" {
			v.Summary = "SPT verification could not complete: " + err.Error()
		}
		if passed {
			v.Status = "passed"
			v.Summary = "All client machines passed SPT verification and the S3 endpoint is reachable."
		}
		v.FinishedAt = utcNow()
		_ = writeFileAtomic(a.verifyFile, v)
	})
}

// runSptVerify runs `spt verify` against the client machines and records each
// machine's result as SPT reports it.
func (a *app) runSptVerify(hosts []string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), verifyTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, a.sptBin, "verify", "--test-hosts", strings.Join(hosts, ","))
	cmd.Dir = a.root
	values := a.configValues()
	for k, v := range map[string]string{"HOSTS": strings.Join(hosts, ","), "SPT_IMAGE": "", "SPT_SKIP_IMAGE_PULL": "false", "NO_COLOR": "1"} {
		values[k] = v
	}
	cmd.Env = envList(values)
	cmd.Stdin = nil
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	cmd.Stderr = cmd.Stdout
	if err = cmd.Start(); err != nil {
		return "", err
	}
	var output io.Reader = stdout
	if f, e := os.OpenFile(filepath.Join(a.stateDir, "verify.log"), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600); e == nil {
		defer f.Close()
		output = io.TeeReader(stdout, &limitedWriter{w: f, left: maxLogBytes})
	}
	index := map[string]int{}
	for i, host := range hosts {
		index[strings.ToLower(hostAddress(host))] = i
	}
	summary := parseVerifyOutput(output, func(host string, node verifyNode) {
		i, ok := index[strings.ToLower(host)]
		if !ok {
			return
		}
		a.updateVerification(func(v *verification) {
			if i < len(v.Nodes) {
				v.Nodes[i].Status = node.Status
				v.Nodes[i].Message = node.Message
				v.Nodes[i].Checks = node.Checks
			}
		})
	})
	_, _ = io.Copy(io.Discard, output)
	err = cmd.Wait()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		err = errors.New("it did not finish within the time limit")
	}
	return summary, err
}

// parseVerifyOutput reads `spt verify` output, calls onNode with a machine's
// result each time it changes, and returns SPT's summary line.
func parseVerifyOutput(r io.Reader, onNode func(host string, node verifyNode)) string {
	nodes := map[string]*verifyNode{}
	get := func(host string) *verifyNode {
		if nodes[host] == nil {
			nodes[host] = &verifyNode{Host: host, Status: "pending", Checks: []verifyCheck{}}
		}
		return nodes[host]
	}
	current, summary := "", ""
	scan := bufio.NewScanner(r)
	scan.Buffer(make([]byte, 64*1024), 1024*1024)
	for scan.Scan() {
		line := strings.TrimRight(scan.Text(), "\r")
		if m := verifyDonePattern.FindStringSubmatch(line); m != nil {
			n := get(m[2])
			n.Status, n.Message = "passed", "Verification complete."
			if m[1] == "❌" {
				n.Status, n.Message = "failed", m[3]
			}
			onNode(m[2], n.clone())
			continue
		}
		if m := verifyNodePattern.FindStringSubmatch(line); m != nil {
			current = m[1]
			get(current).Checks = []verifyCheck{}
			continue
		}
		if m := verifySummaryPattern.FindStringSubmatch(line); m != nil {
			current, summary = "", m[1]
			continue
		}
		if current == "" {
			continue
		}
		n := get(current)
		if m := verifyCheckPattern.FindStringSubmatch(line); m != nil {
			n.Checks = append(n.Checks, verifyCheck{Name: m[1], Status: strings.ToLower(m[2]), Message: m[3]})
			onNode(current, n.clone())
		} else if m := verifyOverallPattern.FindStringSubmatch(line); m != nil {
			n.Status, n.Message = "passed", m[2]
			if m[1] == "❌" {
				n.Status = "failed"
			}
			onNode(current, n.clone())
		}
	}
	return summary
}

// checkEndpoint reports whether the S3 endpoint answers HTTPS from the dashboard
// host. Any HTTP response counts; it does not test credentials or the bucket.
func checkEndpoint(client *http.Client, endpoint string) (status, message string) {
	c := http.Client{}
	if client != nil {
		c = *client
	}
	c.Timeout = endpointTimeout
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return "failed", "The S3 endpoint is not a valid URL."
	}
	resp, err := c.Do(req)
	if err != nil {
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return "failed", "Not reachable from the dashboard host: " + err.Error()
	}
	_ = resp.Body.Close()
	return "passed", fmt.Sprintf("Reachable from the dashboard host (HTTP %d).", resp.StatusCode)
}
