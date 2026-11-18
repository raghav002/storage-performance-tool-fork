import { Tooltip } from "@mantine/core";
import type { ReactNode } from "react";

// A flag's name with its one- or two-sentence description in a tooltip on
// hover (or tap). The field also carries the description as aria-description,
// so keyboard and screen-reader users get it without hovering.
export function FlagHelp({
  help,
  children,
}: {
  help: string;
  children: ReactNode;
}) {
  return (
    <Tooltip
      label={help}
      multiline
      maw={280}
      withArrow
      openDelay={150}
      events={{ hover: true, focus: false, touch: true }}
    >
      <span className="cursor-help underline decoration-dotted decoration-[#9fb3cc] underline-offset-[0.1875rem]">
        {children}
      </span>
    </Tooltip>
  );
}
