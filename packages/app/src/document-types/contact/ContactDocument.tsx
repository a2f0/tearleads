import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useMemo } from "react";
import {
  MiniAppActions,
  MiniAppButton,
} from "../../components/shared/MiniAppLayout";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import { useAppNavigationState } from "../../navigation/AppNavigationProvider";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  StructuredDocument,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import "./ContactDocument.css";
import { ContactFields } from "./ContactFields";
import { readContactFields } from "./contactDocumentModel";
import type { ContactFieldValues } from "./contactFieldDescriptors";

type ContactStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

const CONTACT_DOCUMENT_DONE_ACTION = "Done";
const CONTACT_DOCUMENT_EDIT_ACTION = "Edit";

function toContactFieldValues(
  fields: ReturnType<typeof readContactFields>,
): ContactFieldValues {
  return {
    encapsulationPublicKey: fields.encapsulationPublicKey,
    firstName: fields.firstName,
    lastName: fields.lastName,
    nickname: fields.nickname,
    userId: fields.userId,
  };
}

export function ContactDocumentFields({
  isEditing,
  isRoutedShell,
  ready,
  canWrite,
  setEditing,
  setStructuredFields,
  values,
}: {
  isEditing: boolean;
  isRoutedShell: boolean;
  ready: boolean;
  canWrite: boolean;
  setEditing: (editing: boolean) => void;
  setStructuredFields: ContactStructuredFieldSetter;
  values: ContactFieldValues;
}) {
  const editAction = useMemo(
    () =>
      isRoutedShell
        ? {
            disabled: !ready || !canWrite,
            icon: isEditing ? (
              <CheckIcon aria-hidden size={18} />
            ) : (
              <PencilSimpleIcon aria-hidden size={18} />
            ),
            id: "contact-document-toggle-edit",
            label: isEditing
              ? CONTACT_DOCUMENT_DONE_ACTION
              : CONTACT_DOCUMENT_EDIT_ACTION,
            onClick: () => setEditing(!isEditing),
            priority: 100,
          }
        : null,
    [canWrite, isEditing, isRoutedShell, ready, setEditing],
  );

  useWindowTitleBarAction(editAction);

  return (
    <div className="contact-document-fields">
      {!isRoutedShell && (
        <MiniAppActions>
          <MiniAppButton
            disabled={!ready || !canWrite}
            onClick={() => setEditing(!isEditing)}
          >
            {isEditing
              ? CONTACT_DOCUMENT_DONE_ACTION
              : CONTACT_DOCUMENT_EDIT_ACTION}
          </MiniAppButton>
        </MiniAppActions>
      )}
      <ContactFields
        disabled={!ready || !canWrite}
        isEditing={isEditing && canWrite}
        onFieldCommit={(key, value) => {
          if (canWrite) {
            setStructuredFields("contact", { [key]: value });
          }
        }}
        values={values}
      />
    </div>
  );
}

export function ContactDocument(params: {
  initialEditing?: boolean | undefined;
}) {
  const { mode: navigationMode } = useAppNavigationState();
  const { auth, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { online } = state;
  const { canWrite, ready, setStructuredFields, structuredFields, syncing } =
    useDocument();
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  const isRoutedShell = navigationMode === "routed";
  const values = useMemo(
    () => toContactFieldValues(readContactFields(structuredFields)),
    [structuredFields],
  );

  return (
    <StructuredDocument
      attachmentCopy={{
        authenticatedOnline: "Contact documents do not use attachments.",
        localOnly: "Contact documents do not use attachments.",
        unavailable: "Contact documents do not use attachments.",
      }}
      attachments={null}
      canAttach={false}
      fields={
        <ContactDocumentFields
          isEditing={isEditing}
          isRoutedShell={isRoutedShell}
          ready={ready}
          canWrite={canWrite}
          setEditing={setIsEditing}
          setStructuredFields={setStructuredFields}
          values={values}
        />
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title="Contact"
    />
  );
}
