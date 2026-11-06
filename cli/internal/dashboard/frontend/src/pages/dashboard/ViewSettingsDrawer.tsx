import { Button, Checkbox, Drawer, Paper, Text } from "@mantine/core";
import type { Dispatch, SetStateAction } from "react";
import { allSectionKeys, dashboardSections } from "./sections";

export function ViewSettingsDrawer({
  opened,
  onClose,
  selection,
  onSelectionChange,
}: {
  opened: boolean;
  onClose: () => void;
  selection: string[];
  onSelectionChange: Dispatch<SetStateAction<string[]>>;
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={
        <>
          <Text
            component="span"
            className="block"
            size="xs"
            fw="var(--mantine-font-weight-bold)"
            tt="uppercase"
          >
            Expert view
          </Text>
          <Text
            component="span"
            className="block"
            size="xl"
            c="var(--spt-text-primary)"
            fw="var(--mantine-font-weight-heading)"
          >
            Customize dashboard
          </Text>
        </>
      }
      closeButtonProps={{ "aria-label": "Close customization" }}
    >
      <Text size="sm">
        Show or hide sections. This only changes your display, not the benchmark
        or its data.
      </Text>
      <div className="flex gap-xs">
        <Button onClick={() => onSelectionChange(allSectionKeys())}>
          Show all
        </Button>
        <Button onClick={() => onSelectionChange([])}>Hide all</Button>
      </div>
      <div className="grid gap-2.25">
        {dashboardSections.map((field) => (
          <Paper
            key={field.key}
            p="sm"
            radius="md"
            bg="var(--spt-surface-subtle)"
          >
            <Checkbox
              label={field.title}
              description={field.detail}
              checked={selection.includes(field.key)}
              onChange={(event) =>
                onSelectionChange((previous) =>
                  event.target.checked
                    ? [...previous, field.key]
                    : previous.filter((key) => key !== field.key),
                )
              }
            />
          </Paper>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between gap-compact border-t-[0.0625rem] border-divider pt-comfortable">
        <Text size="sm">
          {selection.length} of {dashboardSections.length} sections shown
        </Text>
        <Button variant="filled" onClick={onClose}>
          Done
        </Button>
      </div>
    </Drawer>
  );
}
