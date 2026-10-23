package server

import "fmt"

// userError is a complete sentence written for the operator and shown as-is
// in the browser, so it keeps its capital letter and final period. Go error
// strings that wrap lower-level causes stay lower-case and unpunctuated.
type userError string

func (e userError) Error() string { return string(e) }

// userErrorf formats a userError. It does not wrap: any cause is already
// rendered into the sentence the operator reads.
func userErrorf(format string, args ...any) error {
	return userError(fmt.Sprintf(format, args...))
}
