package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

type Options struct {
	SPTBinary   string
	WorkDir     string
	StateDir    string
	Port        string
	Output      io.Writer
	OpenBrowser bool
}

func Run(ctx context.Context, opts Options) error {
	if ctx.Err() != nil {
		return nil
	}
	a, err := newApp(opts)
	if err != nil {
		return err
	}
	defer a.stopProcesses()
	listener, err := net.Listen("tcp", "127.0.0.1:"+a.port)
	if err != nil {
		return fmt.Errorf("start dashboard: %w", err)
	}
	defer listener.Close()
	a.port = strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)
	server := a.httpServer()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			a.mu.Lock()
			a.stopping = true
			a.mu.Unlock()
			shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			if err := server.Shutdown(shutdown); err != nil {
				_ = server.Close()
			}
		case <-done:
		}
	}()
	output := opts.Output
	if output == nil {
		output = os.Stdout
	}
	url := "http://127.0.0.1:" + a.port
	fmt.Fprintf(output, "Dashboard running at %s\nPress Ctrl+C to stop.\n", url)
	if opts.OpenBrowser {
		if err := openBrowser(url); err != nil {
			fmt.Fprintf(output, "Could not open browser: %v. Open the URL above manually.\n", err)
		}
	}
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func newApp(opts Options) (*app, error) {
	if maxThreads > 4 || maxRuntime > 600 || maxObjects > 320 {
		return nil, errors.New("dashboard safety limits exceed the reviewed VM profile")
	}
	if expertMaxThreads > 64 || expertMaxRuntime > 3600 || expertMaxObjects > 100_000 || expertMaxTotalBytes > 100<<30 {
		return nil, errors.New("dashboard expert limits exceed the agreed ceiling")
	}
	root := opts.WorkDir
	if root == "" {
		executable, err := os.Executable()
		if err != nil {
			return nil, err
		}
		root = filepath.Dir(executable)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	port := opts.Port
	if port == "" {
		port = os.Getenv("DASHBOARD_PORT")
		if port == "" {
			port = "8000"
		}
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 0 || n > 65535 {
		return nil, errors.New("DASHBOARD_PORT must be a number between 0 and 65535")
	}
	sptBin := opts.SPTBinary
	if sptBin == "" {
		sptBin, _ = exec.LookPath("spt")
		if sptBin == "" && executable("/usr/local/bin/spt") {
			sptBin = "/usr/local/bin/spt"
		}
	}
	stateDir := opts.StateDir
	if stateDir == "" {
		stateDir = filepath.Join(root, ".dashboard-state")
	}
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return nil, err
	}
	dir, err := os.Open(filepath.Clean(stateDir))
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	if err := dir.Chmod(0700); err != nil {
		return nil, err
	}
	a := &app{root: root, home: home, results: filepath.Join(home, "results"), stateDir: stateDir,
		stateFile: filepath.Join(stateDir, "latest-job.json"), lockFile: filepath.Join(stateDir, "job.lock"), port: strconv.Itoa(n), sptBin: sptBin,
		storageFile: filepath.Join(stateDir, "storage-config.json"), verifyFile: filepath.Join(stateDir, "storage-verification.json")}
	a.loadStorage()
	return a, nil
}

func (a *app) httpServer() *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", a.handleRoot)
	mux.HandleFunc("GET /index.html", a.handleRoot)
	mux.HandleFunc("GET /favicon.ico", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /api/state", a.handleState)
	mux.HandleFunc("GET /api/runs", a.handleRunHistory)
	mux.HandleFunc("GET /api/runs/{runID}/csv", a.handleRunCSV)
	mux.HandleFunc("GET /api/runs/{runID}", a.handleSavedRun)
	mux.HandleFunc("POST /api/runs", a.handleRun)
	mux.HandleFunc("POST /api/storage/verify", a.handleVerify)
	return &http.Server{Handler: securityHeaders(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 * 1024}
}

func (a *app) stopProcesses() {
	a.mu.Lock()
	a.stopping = true
	commands := []*exec.Cmd{a.activeCmd, a.verifyCmd}
	a.mu.Unlock()
	for _, cmd := range commands {
		if cmd != nil {
			if err := interruptProcess(cmd.Process); err != nil && !errors.Is(err, os.ErrProcessDone) {
				_ = cmd.Process.Kill()
			}
		}
	}
	a.processes.Wait()
}
