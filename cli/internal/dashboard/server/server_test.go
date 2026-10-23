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

func TestRunServesEmbeddedDashboard(t *testing.T) {
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

func TestRunStartupErrors(t *testing.T) {
	root := t.TempDir()
	for _, port := range []string{"-1", "65536", "invalid"} {
		if err := Run(context.Background(), Options{WorkDir: root, StateDir: root, Port: port, Output: io.Discard}); err == nil {
			t.Errorf("accepted invalid port %q", port)
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

func TestBrowserCommand(t *testing.T) {
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

func TestBrowserFromEnv(t *testing.T) {
	url := "http://127.0.0.1:8000"
	sep := string(os.PathListSeparator)
	for value, want := range map[string][]string{
		"true":                          {"true", url},
		"firefox":                       {"firefox", url},
		"firefox --new-tab":             {"firefox", "--new-tab", url},
		"lynx -dump %s":                 {"lynx", "-dump", url},
		"chromium" + sep + "firefox":    {"chromium", url},
		sep + " " + sep + "w3m":         {"w3m", url},
		"sh -c 'echo; rm -rf /tmp/x' x": {"sh", "-c", "'echo;", "rm", "-rf", "/tmp/x'", "x", url},
	} {
		command := browserFromEnv(value, url)
		if command == nil || !reflect.DeepEqual(command.Args, want) {
			t.Errorf("BROWSER=%q command = %v, want %v", value, command, want)
		}
	}
	for _, value := range []string{"", " ", sep} {
		if command := browserFromEnv(value, url); command != nil {
			t.Errorf("BROWSER=%q should fall back to the platform opener, got %v", value, command.Args)
		}
	}
}

// BROWSER=true must not reach xdg-open: on a headless VM it is how the
// dashboard is started without opening a browser.
func TestOpenBrowserHonorsBrowserEnv(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture requires Unix")
	}
	bin := t.TempDir()
	marker := filepath.Join(bin, "opened")
	for _, name := range []string{"xdg-open", "open"} {
		body := "#!/bin/sh\nprintf '%s' \"$1\" > " + marker + "\n"
		if err := os.WriteFile(filepath.Join(bin, name), []byte(body), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("BROWSER", "true")
	if err := openBrowser("http://127.0.0.1:8000"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	if _, err := os.Stat(marker); err == nil {
		t.Fatal("BROWSER=true still ran the platform opener")
	}
	// Control: without BROWSER the platform opener does run.
	t.Setenv("BROWSER", "")
	if err := openBrowser("http://127.0.0.1:8000"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		if data, err := os.ReadFile(marker); err == nil && string(data) == "http://127.0.0.1:8000" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("platform opener did not run without BROWSER")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestStateDirectoryPermissions(t *testing.T) {
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
