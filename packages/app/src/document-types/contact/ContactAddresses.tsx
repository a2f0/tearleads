import { useState } from "react";
import "./ContactAddresses.css";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  ContactAddressesCard,
  ContactAddressesDetails,
} from "./ContactAddressesCard";
import { ContactAddressesEditor } from "./ContactAddressesEditor";
import {
  isContactAddressRow,
  readContactAddressFields,
} from "./contactAddressModel";
import {
  type ContactAddressEditorInput,
  useContactAddressEditor,
} from "./useContactAddressEditor";

interface ContactAddressesProps extends ContactAddressEditorInput {
  currentAuthorId: string | null;
  resolveRowWriter?: RowWriterResolver | undefined;
}

export function ContactAddresses(props: ContactAddressesProps) {
  const editor = useContactAddressEditor(props);
  const { state, dispatch } = editor;
  const [detailId, setDetailId] = useState<string | null>(null);
  const addresses = props.rows?.filter(isContactAddressRow) ?? [];
  const detail = addresses.find((row) => row.id === detailId);
  const error =
    state.status === "editing" || state.status === "removeFailed"
      ? state.error
      : null;
  return (
    <section aria-label="Addresses" className="contact-addresses">
      <h3>Addresses</h3>
      {props.rows === undefined ? (
        <MiniAppStatus>Loading addresses…</MiniAppStatus>
      ) : addresses.length === 0 ? (
        <MiniAppStatus>No addresses.</MiniAppStatus>
      ) : null}
      {props.isEditing && props.rows !== undefined ? (
        <MiniAppButton
          disabled={!editor.writable || state.status !== "idle"}
          onClick={() =>
            dispatch({
              type: "edit",
              id: null,
              values: readContactAddressFields({}),
            })
          }
        >
          Add address
        </MiniAppButton>
      ) : null}
      {error ? (
        <MiniAppStatus role="alert" tone="error">
          {error}
        </MiniAppStatus>
      ) : null}
      {state.status === "removeFailed" ? (
        <MiniAppButton
          disabled={!editor.writable}
          onClick={() => editor.remove(state.id)}
        >
          Retry address removal
        </MiniAppButton>
      ) : null}
      <ContactAddressesEditor editor={editor} />
      {addresses.map((row) => (
        <ContactAddressesCard
          key={row.id}
          row={row}
          isEditing={props.isEditing}
          disabled={!editor.writable || state.status !== "idle"}
          onEdit={() =>
            dispatch({
              type: "edit",
              id: row.id,
              values: readContactAddressFields(row.fields),
            })
          }
          onRemove={() => editor.remove(row.id)}
          onDetails={() => setDetailId(row.id)}
        />
      ))}
      <p className="contact-addresses-attribution-note">
        Attribution identifies signed uploaders, not necessarily the original
        authors. Times are client-supplied; this is not a full edit history.
      </p>
      {detail ? (
        <ContactAddressesDetails
          row={detail}
          currentAuthorId={props.currentAuthorId}
          resolveRowWriter={props.resolveRowWriter}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </section>
  );
}
