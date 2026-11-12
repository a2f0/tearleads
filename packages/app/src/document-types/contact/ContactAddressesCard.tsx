import type { DocumentRow } from "@tearleads/client-sdk";
import {
  MiniAppActions,
  MiniAppButton,
} from "../../components/mini-app/MiniAppLayout";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { DocumentRowDetailOverlay } from "../shared/DocumentRowDetail";
import {
  CONTACT_ADDRESS_FIELD_DESCRIPTORS,
  readContactAddressFields,
} from "./contactAddressModel";

export function ContactAddressesCard(props: {
  row: DocumentRow;
  isEditing: boolean;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onDetails: () => void;
}) {
  const values = readContactAddressFields(props.row.fields);
  const title = values.label || "Address";
  return (
    <fieldset aria-label={title} className="contact-addresses-card">
      <h4>{title}</h4>
      <dl>
        {CONTACT_ADDRESS_FIELD_DESCRIPTORS.filter(
          ({ key }) => key !== "label" && values[key],
        ).map(({ key, label }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{values[key]}</dd>
          </div>
        ))}
      </dl>
      <MiniAppActions>
        {props.isEditing ? (
          <MiniAppButton disabled={props.disabled} onClick={props.onEdit}>
            Edit address
          </MiniAppButton>
        ) : null}
        {props.isEditing ? (
          <MiniAppButton disabled={props.disabled} onClick={props.onRemove}>
            Remove address
          </MiniAppButton>
        ) : null}
        <MiniAppButton onClick={props.onDetails}>
          Details / attribution
        </MiniAppButton>
      </MiniAppActions>
    </fieldset>
  );
}

export function ContactAddressesDetails(props: {
  row: DocumentRow;
  currentAuthorId: string | null;
  resolveRowWriter?: RowWriterResolver | undefined;
  onClose: () => void;
}) {
  const { row, resolveRowWriter } = props;
  return (
    <DocumentRowDetailOverlay
      title={`${readContactAddressFields(row.fields).label || "Address"} — attribution`}
      fields={CONTACT_ADDRESS_FIELD_DESCRIPTORS.map(({ key, label }) => ({
        label,
        value: row.fields[key] ?? "",
        writerUserId: resolveRowWriter?.(row.fieldEditors[key] ?? null) ?? null,
      }))}
      createdAt={row.createdAt}
      createdBy={resolveRowWriter?.(row.createdByPeer) ?? ""}
      updatedAt={row.updatedAt}
      updatedBy={resolveRowWriter?.(row.updatedByPeer) ?? ""}
      currentAuthorId={props.currentAuthorId}
      showFieldValues={false}
      onClose={props.onClose}
    />
  );
}
