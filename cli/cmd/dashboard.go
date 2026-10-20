package cmd

import (
	"os"
	"path/filepath"

	"github.com/dell/storage-performance-tool/dashboard/server"
	"github.com/spf13/cobra"
)

var runDashboard = server.Run

func startDashboard(cmd *cobra.Command) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	workDir, err := os.Getwd()
	if err != nil {
		return err
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	return runDashboard(cmd.Context(), server.Options{
		SPTBinary: executable, WorkDir: workDir,
		StateDir: filepath.Join(configDir, "spt", "dashboard"),
		Output:   cmd.OutOrStdout(), OpenBrowser: true,
	})
}
