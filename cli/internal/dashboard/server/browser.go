package server

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func browserCommand(platform, url string) (*exec.Cmd, error) {
	switch platform {
	case "linux":
		return exec.Command("xdg-open", url), nil // #nosec G204 -- URL is generated internally for localhost; no shell is used.
	case "darwin":
		return exec.Command("open", url), nil // #nosec G204 -- URL is generated internally for localhost; no shell is used.
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url), nil // #nosec G204 -- URL is generated internally for localhost; no shell is used.
	default:
		return nil, fmt.Errorf("automatic browser opening is unavailable on %s", platform)
	}
}

// browserFromEnv honors the BROWSER convention: a colon-separated list of
// commands, of which the first is used. "%s" in it is replaced by the URL;
// otherwise the URL is appended. The command runs directly, never via a shell.
// BROWSER=true therefore opens nothing, as --no-browser does.
func browserFromEnv(value, url string) *exec.Cmd {
	for _, entry := range strings.Split(value, string(os.PathListSeparator)) {
		fields := strings.Fields(entry)
		if len(fields) == 0 {
			continue
		}
		args := fields[1:]
		substituted := false
		for i, arg := range args {
			if strings.Contains(arg, "%s") {
				args[i] = strings.ReplaceAll(arg, "%s", url)
				substituted = true
			}
		}
		if !substituted {
			args = append(args, url)
		}
		return exec.Command(fields[0], args...) // #nosec G204 G702 -- the user's own BROWSER setting, run without a shell
	}
	return nil
}

func openBrowser(url string) error {
	cmd := browserFromEnv(os.Getenv("BROWSER"), url)
	if cmd == nil {
		var err error
		if cmd, err = browserCommand(runtime.GOOS, url); err != nil {
			return err
		}
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
