import type { KeyboardEvent } from "react";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { ORG_MANAGER_LABELS } from "../labels";

export { useProfileDocumentLink } from "./profileDocumentLink";

// Shared pieces of the roster-profile and organization-profile editors: the
// commit-on-Enter field behavior, the read-only display row, and the effect
// that relinks the profile document store to its container.

export function blurOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  }
}

export function ProfileReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const normalizedValue = value?.trim() ?? "";

  return (
    <MiniAppRow className="org-manager-roster-row" density="roomy">
      <MiniAppRowStack>
        <strong>{label}</strong>
        <MiniAppRowText muted title={value ?? undefined}>
          {normalizedValue.length > 0
            ? normalizedValue
            : ORG_MANAGER_LABELS.none}
        </MiniAppRowText>
      </MiniAppRowStack>
    </MiniAppRow>
  );
}
