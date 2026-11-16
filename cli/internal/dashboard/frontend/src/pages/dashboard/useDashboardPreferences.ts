import { useEffect, useState } from "react";
import { allSectionKeys } from "./sections";

const expertViewSelectionKey = "spt-expert-visible-sections-v1";
function loadVisibleSections(): string[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(expertViewSelectionKey) ?? "null",
    );
    if (!Array.isArray(stored)) return allSectionKeys();
    return allSectionKeys().filter((key) => stored.includes(key));
  } catch {
    return allSectionKeys();
  }
}

export function useDashboardPreferences() {
  const [selection, setSelection] = useState<string[]>(loadVisibleSections);
  // View preferences are browser-only. They do not affect the SPT run or API.
  useEffect(() => {
    try {
      localStorage.setItem(expertViewSelectionKey, JSON.stringify(selection));
    } catch {
      // The dashboard still works if browser storage is unavailable.
    }
  }, [selection]);
  return [selection, setSelection] as const;
}
