package cmd

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dell/storage-performance-tool/cli/internal/dashboard/server"
	"github.com/spf13/cobra"
)

func newDashboardTestRoot() *cobra.Command {
	root := &cobra.Command{Use: "spt"}
	command := newDashboardCommand()
	command.PersistentPreRunE = nil
	root.AddCommand(command)
	root.SetOut(io.Discard)
	root.SetErr(io.Discard)
	return root
}

func TestDashboardLauncher(t *testing.T) {
	original := runDashboard
	t.Cleanup(func() { runDashboard = original })
	for _, test := range []struct {
		name        string
		args        []string
		port        string
		openBrowser bool
		configFile  string
	}{
		{"defaults", []string{"dashboard"}, "", true, ""},
		{"headless", []string{"dashboard", "--port", "9000", "--no-browser"}, "9000", false, ""},
		{"free port", []string{"dashboard", "--port", "0"}, "0", true, ""},
		{"explicit default port", []string{"dashboard", "--port", "8000"}, "8000", true, ""},
		{"settings file", []string{"dashboard", "--config", "dashboard.json"}, "", true, "dashboard.json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			output := new(bytes.Buffer)
			wantErr := errors.New("server startup failed")
			var got server.Options
			runDashboard = func(received context.Context, opts server.Options) error {
				if received != ctx {
					t.Error("dashboard did not receive command context")
				}
				got = opts
				return wantErr
			}
			command := newDashboardTestRoot()
			command.SetContext(ctx)
			command.SetOut(output)
			command.SetErr(output)
			command.SetArgs(test.args)
			if err := command.Execute(); !errors.Is(err, wantErr) {
				t.Fatalf("error = %v, want %v", err, wantErr)
			}
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			workDir, err := os.Getwd()
			if err != nil {
				t.Fatal(err)
			}
			configDir, err := os.UserConfigDir()
			if err != nil {
				t.Fatal(err)
			}
			if got.SPTBinary != executable || got.WorkDir != workDir || got.StateDir != filepath.Join(configDir, "spt", "dashboard") {
				t.Fatalf("unexpected dashboard paths: %+v", got)
			}
			if got.Port != test.port || got.ConfigFile != test.configFile || got.OpenBrowser != test.openBrowser || got.Output != output {
				t.Fatalf("unexpected dashboard options: %+v", got)
			}
		})
	}
}

func TestDashboardCommandRegistration(t *testing.T) {
	command, _, err := rootCmd.Find([]string{"dashboard"})
	if err != nil || command.Name() != "dashboard" {
		t.Fatalf("dashboard command not registered: %v", err)
	}
	for _, flag := range []string{"dashboard", "port", "no-browser", "config"} {
		if rootCmd.Flags().Lookup(flag) != nil || rootCmd.PersistentFlags().Lookup(flag) != nil {
			t.Fatalf("dashboard flag %q leaked onto root command", flag)
		}
	}
}

func TestDashboardInvalidArguments(t *testing.T) {
	original := runDashboard
	t.Cleanup(func() { runDashboard = original })
	runDashboard = func(context.Context, server.Options) error {
		t.Fatal("invalid arguments started the dashboard")
		return nil
	}
	for _, args := range [][]string{
		{"--dashboard"},
		{"--port", "9000"},
		{"--no-browser"},
		{"--config", "dashboard.json"},
		{"dashboard", "extra"},
		{"dashboard", "--port", "invalid"},
		{"dashboard", "--port="},
		{"dashboard", "--unknown"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			command := newDashboardTestRoot()
			command.SetArgs(args)
			if err := command.Execute(); err == nil {
				t.Fatal("invalid dashboard arguments were accepted")
			}
		})
	}
}

func TestDashboardHelp(t *testing.T) {
	original := runDashboard
	t.Cleanup(func() { runDashboard = original })
	runDashboard = func(context.Context, server.Options) error {
		t.Fatal("help started the dashboard")
		return nil
	}
	output := new(bytes.Buffer)
	command := newDashboardTestRoot()
	command.SetOut(output)
	command.SetArgs([]string{"dashboard", "--help"})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"spt dashboard", "--port", "--no-browser", "--config", "localhost", "DASHBOARD_PORT", "8000"} {
		if !strings.Contains(output.String(), text) {
			t.Errorf("dashboard help does not mention %q", text)
		}
	}
}
