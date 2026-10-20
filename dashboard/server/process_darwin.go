package server

import (
	"os"
	"os/exec"
	"syscall"
)

func lockFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}

func unlockFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
}

func prepareProcess(cmd *exec.Cmd, lock *os.File) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if lock != nil {
		cmd.ExtraFiles = []*os.File{lock}
	}
}

func interruptProcess(process *os.Process) error {
	return process.Signal(os.Interrupt)
}
