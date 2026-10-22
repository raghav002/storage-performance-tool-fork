package server

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestDashboardServesEmbeddedPage(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader, writer := io.Pipe()
	defer reader.Close()
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, Options{WorkDir: root, StateDir: filepath.Join(root, "state"), Port: "0", Output: writer})
		_ = writer.Close()
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("server shutdown: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Error("server did not shut down")
		}
	})
	lines := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(reader).ReadString('\n')
		lines <- line
	}()
	var url string
	select {
	case line := <-lines:
		url = strings.TrimSpace(strings.TrimPrefix(line, "Dashboard running at "))
	case <-time.After(5 * time.Second):
		t.Fatal("server did not announce its URL")
	}
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK || !strings.Contains(string(body), "<html") {
		t.Fatalf("embedded page: status %d, error %v", response.StatusCode, err)
	}
	response, err = client.Get(url + "/api/state")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var state map[string]any
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || state["job"] != nil || state["target"] == nil || state["limits"] == nil {
		t.Fatalf("unexpected initial state: %#v", state)
	}
	if _, err := os.Stat(filepath.Join(root, "state", "latest-job.json")); !os.IsNotExist(err) {
		t.Fatalf("opening dashboard created a job: %v", err)
	}
}

func TestDashboardStartupErrors(t *testing.T) {
	root := t.TempDir()
	for _, port := range []string{"-1", "65536", "invalid"} {
		if err := Run(context.Background(), Options{WorkDir: root, StateDir: root, Port: port, Output: io.Discard}); err == nil || !strings.Contains(err.Error(), "--port or DASHBOARD_PORT") {
			t.Errorf("invalid port %q: %v", port, err)
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	output := new(strings.Builder)
	if err := Run(context.Background(), Options{WorkDir: root, StateDir: root, Port: port, Output: output, OpenBrowser: true}); err == nil {
		t.Fatal("accepted occupied port")
	}
	if output.Len() != 0 {
		t.Fatal("server announced readiness before binding")
	}
}

func TestDashboardBrowserCommand(t *testing.T) {
	url := "http://127.0.0.1:8000"
	for platform, args := range map[string][]string{
		"linux":   {"xdg-open", url},
		"darwin":  {"open", url},
		"windows": {"rundll32", "url.dll,FileProtocolHandler", url},
	} {
		command, err := browserCommand(platform, url)
		if err != nil || !reflect.DeepEqual(command.Args, args) {
			t.Errorf("%s browser command = %v, error %v", platform, command, err)
		}
	}
	if _, err := browserCommand("unsupported", url); err == nil {
		t.Fatal("unsupported browser command succeeded")
	}
}

func TestDashboardStateDirectoryPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix directory permissions")
	}
	root := t.TempDir()
	t.Setenv("HOME", root)
	stateDir := filepath.Join(root, "state")
	if err := os.Mkdir(stateDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(stateDir, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := newApp(Options{WorkDir: root, StateDir: stateDir, Port: "0"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0700 {
		t.Fatalf("state directory permissions = %o, want 700", info.Mode().Perm())
	}
}

func TestDashboardPortPrecedence(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	for _, test := range []struct {
		name string
		env  string
		port string
		want string
	}{
		{"default", "", "", "8000"},
		{"environment", "9000", "", "9000"},
		{"explicit", "9000", "9001", "9001"},
		{"free port", "9000", "0", "0"},
		{"explicit default", "9000", "8000", "8000"},
		{"override invalid environment", "invalid", "9001", "9001"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("DASHBOARD_PORT", test.env)
			a, err := newApp(Options{WorkDir: root, StateDir: root, Port: test.port})
			if err != nil {
				t.Fatal(err)
			}
			if a.port != test.want {
				t.Fatalf("port = %q, want %q", a.port, test.want)
			}
		})
	}
	t.Setenv("DASHBOARD_PORT", "invalid")
	if _, err := newApp(Options{WorkDir: root, StateDir: root}); err == nil {
		t.Fatal("invalid environment port was accepted")
	}
}
