import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useIdentityLinks } from "../../../providers/identity-links/useIdentityLinks";
import type { useLog } from "../../../providers/logging/LogProvider";
import type { useContacts } from "../../../stores/contacts/ContactsProvider";
import { useImportContactByUserId } from "./useContactImport";
import { useImportContactIdentityLink } from "./useImportContactIdentityLink";

function hasContactNameDraft(params: {
  firstName: string;
  lastName: string;
  nickname: string;
}): boolean {
  return (
    params.nickname.trim().length > 0 ||
    params.firstName.trim().length > 0 ||
    params.lastName.trim().length > 0
  );
}

function useCreateDraftContact(input: {
  canCreate: boolean;
  createContact: ReturnType<typeof useContacts>["createContact"];
  draftFirstName: string;
  draftLastName: string;
  draftNickname: string;
  isSubmittingRef: { current: boolean };
  logError: ReturnType<typeof useLog>["logError"];
  setDraftFirstName: Dispatch<SetStateAction<string>>;
  setDraftLastName: Dispatch<SetStateAction<string>>;
  setDraftNickname: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setSelectedContactId: (contactId: string) => void;
}) {
  const {
    canCreate,
    createContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    isSubmittingRef,
    logError,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setIsSubmitting,
    setSelectedContactId,
  } = input;

  return useCallback(async () => {
    if (!canCreate || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const contactId = await createContact({
        firstName: draftFirstName,
        lastName: draftLastName,
        nickname: draftNickname,
      });
      if (contactId) {
        setSelectedContactId(contactId);
        setDraftFirstName("");
        setDraftLastName("");
        setDraftNickname("");
      }
    } catch (error: unknown) {
      logError("Contacts: failed to create contact.", error);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    canCreate,
    createContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    isSubmittingRef,
    logError,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setIsSubmitting,
    setSelectedContactId,
  ]);
}

function useIdentityLinkDraft(token: string | undefined) {
  const { linkFromToken } = useIdentityLinks();
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (token) setDraft(linkFromToken(token));
  }, [linkFromToken, token]);
  return [draft, setDraft] as const;
}

interface ContactDraftsInput {
  identityLinkToken?: string | undefined;
  identityScope: string;
  openImportContactRoute: () => void;
  canWrite: boolean;
  createContact: ReturnType<typeof useContacts>["createContact"];
  importVerifiedUser: ReturnType<typeof useContacts>["importVerifiedUser"];
  isAuthenticated: boolean;
  logError: ReturnType<typeof useLog>["logError"];
  ready: boolean;
  setSelectedContactId: (contactId: string) => void;
}

export function useContactDrafts(input: ContactDraftsInput) {
  const {
    canWrite,
    createContact,
    importVerifiedUser,
    isAuthenticated,
    logError,
    ready,
    setSelectedContactId,
  } = input;
  const [draftFirstName, setDraftFirstName] = useState("");
  const [draftLastName, setDraftLastName] = useState("");
  const [draftNickname, setDraftNickname] = useState("");
  const [draftUserId, setDraftUserId] = useIdentityLinkDraft(
    input.identityLinkToken,
  );
  const { verifyLink, resolveVerified } = useIdentityLinks();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const canCreate =
    !isSubmitting &&
    canWrite &&
    ready &&
    hasContactNameDraft({
      firstName: draftFirstName,
      lastName: draftLastName,
      nickname: draftNickname,
    });
  const isImportReady = canWrite && ready && isAuthenticated;

  const createDraftContact = useCreateDraftContact({
    canCreate,
    createContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    isSubmittingRef,
    logError,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setIsSubmitting,
    setSelectedContactId,
  });
  const importContactByUserId = useImportContactByUserId({
    ...input,
    resolveVerified,
    onUnverifiedIdentity: input.openImportContactRoute,
    isImportReady,
    isSubmittingRef,
    setIsSubmitting,
  });
  const { importContact: importDraftContact, error: importError } =
    useImportContactIdentityLink({
      logError,
      draft: draftUserId,
      identityScope: input.identityScope,
      importVerifiedUser,
      isImportReady,
      isSubmittingRef,
      setIsSubmitting,
      verifyLink,
      onImported: setSelectedContactId,
      setDraft: setDraftUserId,
    });

  return {
    canCreate,
    canImport: !isSubmitting && isImportReady && draftUserId.trim().length > 0,
    createDraftContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    draftUserId,
    importContactByUserId,
    importDraftContact,
    importError,
    isImportReady,
    isSubmitting,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setDraftUserId,
  };
}
