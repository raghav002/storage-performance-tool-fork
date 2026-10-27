export function Status({ status }: { status: string }) {
  return (
    <span
      className={`status ${status === "completed" || status === "ready" ? "good" : "warn"}`}
    >
      <i />
      {status}
    </span>
  );
}
