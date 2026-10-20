package cmd

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/dell/storage-performance-tool/dashboard/server"
	"github.com/spf13/cobra"
)

func TestDashboardLauncher(t *testing.T) {
	original := runDashboard
	t.Cleanup(func() { runDashboard = original })
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
	command := &cobra.Command{Use: "spt", RunE: rootCmd.RunE}
	command.Flags().Bool("dashboard", false, rootCmd.Flags().Lookup("dashboard").Usage)
	command.SetContext(ctx)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs([]string{"--dashboard"})
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
	if !got.OpenBrowser || got.Output != output {
		t.Fatalf("unexpected browser/output configuration: %+v", got)
	}
}

func TestDashboardFlagIsRootOnly(t *testing.T) {
	if rootCmd.Flags().Lookup("dashboard") == nil || rootCmd.PersistentFlags().Lookup("dashboard") != nil {
		t.Fatal("dashboard must be a root-only flag")
	}
	if err := runCmd.ParseFlags([]string{"write", "--dashboard"}); err == nil {
		t.Fatal("run command accepted --dashboard")
	}
}
