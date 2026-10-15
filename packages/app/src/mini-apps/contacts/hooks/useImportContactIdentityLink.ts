import type { UserIdentities } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

interface ContactIdentityLinkImport {
  draft: string;
  identityScope: string;
  logError: (message: string, cause: unknown) => void;
  importKey: (userId: string) => Promise<string | null>;
  isImportReady: boolean;
  isSubmittingRef: { current: boolean };
  setIsSubmitting: (value: boolean) => void;
  setDraft: (value: string) => void;
  onImported: (contactId: string) => void;
  verifyLink: UserIdentities["verifyLink"];
}

function importFailure(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to verify this identity link.";
}

export function useImportContactIdentityLink(input: ContactIdentityLinkImport) {
  const [error, setError] = useState<string | null>(null);
  const live = useRef<ContactIdentityLinkImport | null>(input);
  useEffect(() => {
    live.current = input;
    return () => {
      live.current = null;
    };
  });
  const importContact = useCallback(async () => {
    if (
      !input.isImportReady ||
      input.isSubmittingRef.current ||
      !input.draft.trim()
    )
      return;
    const active = () =>
      live.current?.identityScope === input.identityScope &&
      live.current.importKey === input.importKey &&
      live.current.isImportReady;
    input.isSubmittingRef.current = true;
    input.setIsSubmitting(true);
    setError(null);
    try {
      const identity = await input.verifyLink(input.draft);
      if (!active()) return;
      const contactId = await input.importKey(identity.userId);
      if (!active()) return;
      if (!contactId)
        throw new Error(
          "The identity was verified, but the contact could not be added. Try again.",
        );
      input.onImported(contactId);
      input.setDraft("");
    } catch (caught) {
      if (active()) {
        input.logError("Contacts: failed to import identity link.", caught);
        setError(importFailure(caught));
      }
    } finally {
      input.isSubmittingRef.current = false;
      if (live.current) input.setIsSubmitting(false);
    }
  }, [
    input.draft,
    input.identityScope,
    input.logError,
    input.importKey,
    input.isImportReady,
    input.isSubmittingRef,
    input.onImported,
    input.setDraft,
    input.setIsSubmitting,
    input.verifyLink,
  ]);
  return { importContact, error };
}
