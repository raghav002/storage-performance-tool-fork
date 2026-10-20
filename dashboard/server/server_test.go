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
