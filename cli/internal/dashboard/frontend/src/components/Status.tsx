export function Status({ status }: { status: string }) {
  return (
    <span
      data-spt-legacy=""
      className={`status ${status === "completed" || status === "ready" ? "good" : "warn"}`}
    >
      <i data-spt-legacy="" />
      {status}
    </span>
  );
}
