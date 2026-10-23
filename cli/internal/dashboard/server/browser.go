package server

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
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

// browserFromEnv honors the BROWSER convention: a colon-separated list of
// commands, of which the first is used. "%s" in it is replaced by the URL;
// otherwise the URL is appended. The command runs directly, never via a shell.
// BROWSER=true therefore opens nothing, which is how a headless VM skips the
// browser until a --no-browser flag lands (Alex's PR #12).
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
