package cmd

import (
	"os"
	"path/filepath"
	"strconv"

	"github.com/dell/storage-performance-tool/dashboard/server"
	"github.com/spf13/cobra"
)

var runDashboard = server.Run

func newDashboardCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "dashboard",
		Short: "Open the web dashboard",
		Long: `Start the web dashboard on localhost and open it in your browser.
Keep the terminal open. Press Ctrl+C to stop the dashboard and any active run.
For SSH access, forward the dashboard port to your local machine.

The port defaults to DASHBOARD_PORT or 8000. Use --port to override it.
Use --no-browser on servers without a desktop.`,
		Example: `  spt dashboard
  spt dashboard --port 9000
  spt dashboard --no-browser`,
		Args:              cobra.NoArgs,
		PersistentPreRunE: rootCmd.PersistentPreRunE,
		RunE:              startDashboard,
	}
	cmd.Flags().Int("port", 8000, "Local port (overrides DASHBOARD_PORT; 0 selects a free port)")
	cmd.Flags().Bool("no-browser", false, "Do not open a browser")
	return cmd
}

func init() {
	rootCmd.AddCommand(newDashboardCommand())
}

func startDashboard(cmd *cobra.Command, _ []string) error {
	port := ""
	if cmd.Flags().Changed("port") {
		value, err := cmd.Flags().GetInt("port")
		if err != nil {
			return err
		}
		port = strconv.Itoa(value)
	}
	noBrowser, err := cmd.Flags().GetBool("no-browser")
	if err != nil {
		return err
	}
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
		Port:     port, Output: cmd.OutOrStdout(), OpenBrowser: !noBrowser,
	})
}
