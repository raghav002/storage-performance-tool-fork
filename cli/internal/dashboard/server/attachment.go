package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dell/storage-performance-tool/cli/internal/constants"
)

type attachRequest struct {
	Host string `json:"host"`
}

type attachedStatus struct {
	RunID    string  `json:"runId"`
	State    string  `json:"state"`
	Message  string  `json:"message"`
	Progress float64 `json:"progress"`
}

func (a *app) handleAttach(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Endpoint not found."})
		return
	}
	if !a.sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "Connect requests must come from this dashboard through its SSH tunnel."})
		return
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "Send the client machine to monitor."})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var requested attachRequest
	if err := dec.Decode(&requested); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Choose a configured client machine."})
		return
	}
	if err := ensureEOF(dec); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Send one client machine."})
		return
	}
	host := strings.TrimSpace(requested.Host)
	if err := validateHostEntry(host); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Choose a valid configured client machine."})
		return
	}
	approved := false
	for _, configured := range a.storageSnapshot().Hosts {
		if hostAddress(configured) == hostAddress(host) {
			approved = true
			break
		}
	}
	if !approved {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Choose a client machine already listed in Storage configuration."})
		return
	}
	a.mu.Lock()
	a.attachedHost = hostAddress(host)
	a.attachedRunID = ""
	a.attachedRows = nil
	a.mu.Unlock()
	state, err := a.attachedState()
	if err != nil {
		a.mu.Lock()
		a.attachedHost = ""
		a.attachedRunID = ""
		a.attachedRows = nil
		a.mu.Unlock()
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *app) handleDetach(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "Endpoint not found."})
		return
	}
	if !a.sameOrigin(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "Disconnect requests must come from this dashboard through its SSH tunnel."})
		return
	}
	a.mu.Lock()
	a.attachedHost = ""
	a.attachedRunID = ""
	a.attachedRows = nil
	a.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"status": "disconnected"})
}

func (a *app) attachedState() (map[string]any, error) {
	a.mu.Lock()
	host := a.attachedHost
	a.mu.Unlock()
	if host == "" {
		return nil, errors.New("No SPT run is selected. Choose a configured client machine and retry.")
	}
	apiPort := constants.SptAPIPortInt
	if a.sptAPIPort != "" {
		if parsed, err := strconv.Atoi(a.sptAPIPort); err == nil && parsed > 0 && parsed < 65536 {
			apiPort = parsed
		}
	}
	baseURL := "http://" + net.JoinHostPort(host, strconv.Itoa(apiPort))
	status, err := fetchAttachedStatus(baseURL)
	if err != nil {
		return nil, fmt.Errorf("Could not reach SPT on %s. Check that its API is running on port %d, then retry. Details: %v", host, apiPort, err)
	}
	if status.RunID == "" || !strings.EqualFold(status.State, "running") {
		return nil, fmt.Errorf("SPT on %s is reachable, but it is not reporting an active run. Start or select an existing SPT run, then retry.", host)
	}
	if status.Progress < 0 || status.Progress > 100 {
		status.Progress = 0
	}
	a.mu.Lock()
	if a.attachedRunID != status.RunID {
		a.attachedRunID = status.RunID
		a.attachedRows = nil
	}
	a.mu.Unlock()
	apiState := map[string]any{"run_id": status.RunID, "started_epoch": float64(0)}
	metrics := a.liveMetricsAt(apiState, baseURL+"/metrics/json")
	if metrics == nil {
		metrics = map[string]any{"run_id": status.RunID, "workload_type": "live SPT run", "source_file": metricsContract, "is_active": true, "is_aggregate": false, "samples": []map[string]any{}, "chart_samples": []map[string]any{}}
	}
	rows, _ := metrics["samples"].([]map[string]any)
	a.mu.Lock()
	if a.attachedRunID == status.RunID && len(rows) > 0 {
		latest := rows[0]
		lastTimestamp := ""
		if count := len(a.attachedRows); count > 0 {
			lastTimestamp = str(a.attachedRows[count-1]["timestamp"])
		}
		if stamp := str(latest["timestamp"]); stamp != "" && stamp != lastTimestamp {
			a.attachedRows = append(a.attachedRows, cloneMap(latest))
			if len(a.attachedRows) > maxSamples {
				a.attachedRows = append([]map[string]any(nil), a.attachedRows[len(a.attachedRows)-maxSamples:]...)
			}
		}
	}
	chartRows := append([]map[string]any(nil), a.attachedRows...)
	host = a.attachedHost
	a.mu.Unlock()
	metrics["chart_samples"] = chartRows
	if len(rows) == 0 && len(chartRows) > 0 {
		metrics["samples"] = []map[string]any{chartRows[len(chartRows)-1]}
	}
	if len(rows) > 0 {
		metrics["samples"] = rows
	}
	metrics["progress_percent"] = status.Progress
	phase := "Waiting for first SPT measurement"
	if len(rows) > 0 {
		phase = firstNonempty(str(rows[0]["op_type"]), str(rows[0]["step_id"]), phase)
	}
	message := strings.TrimSpace(status.Message)
	if message == "" {
		message = "Monitoring the existing SPT run. This dashboard will not start or stop it."
	}
	job := map[string]any{"run_id": status.RunID, "status": "running", "phase": phase, "message": message, "progress_percent": status.Progress}
	state := a.stateResponse(job, metrics)
	state["connection"] = map[string]any{"status": "connected", "mode": "attached", "host": host, "run_id": status.RunID, "read_only": true}
	return state, nil
}

func fetchAttachedStatus(baseURL string) (attachedStatus, error) {
	var payload attachedStatus
	u, err := url.Parse(baseURL + "/status")
	if err != nil || u.Host == "" {
		return payload, errors.New("invalid SPT API address")
	}
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return payload, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return payload, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return payload, fmt.Errorf("SPT /status returned HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&payload); err != nil {
		return payload, fmt.Errorf("could not read SPT /status: %w", err)
	}
	return payload, nil
}
