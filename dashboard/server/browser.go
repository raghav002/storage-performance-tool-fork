package server

import (
	"fmt"
	"os/exec"
	"runtime"
)

func browserCommand(platform, url string) (*exec.Cmd, error) {
	switch platform {
	case "linux":
		return exec.Command("xdg-open", url), nil
	case "darwin":
		return exec.Command("open", url), nil
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url), nil
	default:
		return nil, fmt.Errorf("automatic browser opening is unavailable on %s", platform)
	}
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
