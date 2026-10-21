package cmd

import (
	"os"
	"path/filepath"

	"github.com/dell/storage-performance-tool/cli/internal/config"
	"github.com/dell/storage-performance-tool/cli/internal/dashboard/server"
	"github.com/spf13/cobra"
)

var runDashboard = server.Run

var dashboardPort string
var dashboardConfig string

var dashboardCmd = &cobra.Command{
	Use:   "dashboard",
	Short: "Start the local web dashboard",
	Args:  cobra.NoArgs,
	PersistentPreRunE: func(_ *cobra.Command, _ []string) error {
		_ = config.LoadDotEnv()
		return initializeLogger()
	},
	RunE: func(cmd *cobra.Command, _ []string) error { return startDashboard(cmd) },
}

func init() {
	dashboardCmd.Flags().StringVar(&dashboardPort, "port", "", "Local port to serve the dashboard on (default 8000)")
	dashboardCmd.Flags().StringVar(&dashboardConfig, "config", "", "Path to dashboard settings JSON")
	rootCmd.AddCommand(dashboardCmd)
}

func startDashboard(cmd *cobra.Command) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	return runDashboard(cmd.Context(), server.Options{
		SPTBinary: executable, WorkDir: filepath.Dir(executable),
		StateDir: filepath.Join(configDir, "spt", "dashboard"),
		Port:     dashboardPort, ConfigFile: dashboardConfig,
		Output: cmd.OutOrStdout(), OpenBrowser: true,
	})
}
