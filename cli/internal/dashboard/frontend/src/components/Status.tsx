import { Badge } from "@mantine/core";

export function Status({ status }: { status: string }) {
  const good = ["completed", "complete", "ready", "passed"].includes(status);
  return (
    <Badge
      color={good ? "teal" : "yellow"}
      leftSection={
        <span
          className="size-1.25 rounded-full bg-current"
          aria-hidden="true"
        />
      }
    >
      {status}
    </Badge>
  );
}
