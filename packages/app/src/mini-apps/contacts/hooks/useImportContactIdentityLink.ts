import type { UserIdentities } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

interface ContactIdentityLinkImport {
  draft: string;
  identityScope: string;
  logError: (message: string, cause: unknown) => void;
  importVerifiedUser: (userId: string) => Promise<string | null>;
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
  const [failure, setFailure] = useState<{
    draft: string;
    identityScope: string;
    message: string;
  } | null>(null);
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
      live.current.importVerifiedUser === input.importVerifiedUser &&
      live.current.isImportReady;
    input.isSubmittingRef.current = true;
    input.setIsSubmitting(true);
    setFailure(null);
    try {
      const identity = await input.verifyLink(input.draft);
      if (!active()) return;
      const contactId = await input.importVerifiedUser(identity.userId);
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
        setFailure({
          draft: input.draft,
          identityScope: input.identityScope,
          message: importFailure(caught),
        });
      }
    } finally {
      input.isSubmittingRef.current = false;
      if (live.current) input.setIsSubmitting(false);
    }
  }, [
    input.draft,
    input.identityScope,
    input.logError,
    input.importVerifiedUser,
    input.isImportReady,
    input.isSubmittingRef,
    input.onImported,
    input.setDraft,
    input.setIsSubmitting,
    input.verifyLink,
  ]);
  const error =
    failure?.draft === input.draft &&
    failure.identityScope === input.identityScope
      ? failure.message
      : null;
  return { importContact, error };
}
