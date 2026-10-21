package server

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"time"
)

func drainOutput(src io.Reader, path string) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600) // #nosec G304 -- state directory plus a server-generated run ID
	if err != nil {
		_, _ = io.Copy(io.Discard, src)
		return
	}
	defer f.Close()
	_, _ = io.Copy(io.MultiWriter(&limitedWriter{w: f, left: maxLogBytes}, io.Discard), src)
}

func (a *app) watchProcess(runID string, cmd *exec.Cmd, lock *os.File, drained <-chan struct{}) {
	defer a.processes.Done()
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

func (a *app) lockBusy() bool {
	f, e := os.OpenFile(a.lockFile, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return false
	}
	defer f.Close()
	if lockFile(f) != nil {
		return true
	}
	_ = unlockFile(f)
	return false
}

func regularFile(path string) bool {
	info, e := os.Stat(path)
	return e == nil && info.Mode().IsRegular()
}
