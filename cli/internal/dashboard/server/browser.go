package server

import (
	"fmt"
	"os/exec"
	"runtime"
)

func browserCommand(platform, url string) (*exec.Cmd, error) {
	var cmd *exec.Cmd
	switch platform {
	case "linux":
		cmd = exec.Command("xdg-open")
	case "darwin":
		cmd = exec.Command("open")
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler")
	default:
		return nil, fmt.Errorf("automatic browser opening is unavailable on %s", platform)
	}
	cmd.Args = append(cmd.Args, url)
	return cmd, nil
}

func openBrowser(url string) error {
	cmd, err := browserCommand(runtime.GOOS, url)
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
