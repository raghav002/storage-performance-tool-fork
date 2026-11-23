import { Tooltip } from "@mantine/core";
import type { ReactNode } from "react";

// A flag's name with its one- or two-sentence description in a tooltip on
// hover (or tap). The field also carries the description as aria-description,
// so keyboard and screen-reader users get it without hovering.
//
// The name is lifted above its field (relative, z-1): Mantine's Switch
// stretches its invisible <input> over the whole control, label included,
// so without this the pointer lands on the input and the tooltip never opens.
// A click on the name still toggles the switch, since it stays in its <label>.
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
      <span
        data-flag-help=""
        className="relative z-1 cursor-help underline decoration-dotted decoration-[#9fb3cc] underline-offset-[0.1875rem]"
      >
        {children}
      </span>
    </Tooltip>
  );
}
