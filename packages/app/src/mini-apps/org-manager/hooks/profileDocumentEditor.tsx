import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import type { useDocument } from "../../../stores/documents/DocumentsProvider";
import { ORG_MANAGER_LABELS } from "../labels";

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

/**
 * Relinks the mounted document store to the profile document once the store
 * reports the expected document, and tracks whether that link is usable.
 * `relinkInput` must be referentially stable (memoized) between renders.
 */
export function useProfileDocumentLink({
  documentId,
  profileDocumentId,
  ready,
  relink,
  relinkInput,
}: {
  documentId: string | null;
  profileDocumentId: string | null;
  ready: boolean;
  relink: ReturnType<typeof useDocument>["relink"];
  relinkInput: Parameters<ReturnType<typeof useDocument>["relink"]>[0] | null;
}): { linkFailed: boolean; linkReady: boolean } {
  const [linkFailed, setLinkFailed] = useState(false);
  const [linkReady, setLinkReady] = useState(false);

  useEffect(() => {
    setLinkFailed(false);
    setLinkReady(false);
    if (
      !ready ||
      !documentId ||
      !relinkInput ||
      documentId !== profileDocumentId
    ) {
      return;
    }

    let cancelled = false;
    void relink(relinkInput)
      .then((result) => {
        if (!cancelled && result !== null) {
          setLinkReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentId, profileDocumentId, ready, relink, relinkInput]);

  return { linkFailed, linkReady };
}
