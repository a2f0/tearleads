import type { ComponentType } from "react";
import { useId } from "react";
import type { useDocument } from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { createDocumentTypeApp } from "./createDocumentTypeApp";
import { DocumentAttachmentSlots } from "./DocumentAttachmentSlots";
import {
  EQUIPMENT_ATTACHMENT_SLOTS,
  type EquipmentDocumentFields,
  type EquipmentDocumentTypeDefinition,
  type EquipmentTypeOption,
  getEquipmentTypeLabel,
  readEquipmentFields,
} from "./equipmentDocumentDefinition";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditAction,
} from "./StructuredDocument";
import { useAttachedStructuredDocument } from "./useAttachedStructuredDocument";
import "./EquipmentDocument.css";

type EquipmentStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

interface EquipmentFieldInputIds {
  equipmentType: string;
  make: string;
  model: string;
  serialNumber: string;
}

export function EquipmentFields(params: {
  // The capitalized kind name that prefixes every control's accessible name,
  // e.g. "Tool" → "Tool make".
  ariaLabelPrefix: string;
  disabled?: boolean | undefined;
  fields: EquipmentDocumentFields;
  inputIds: EquipmentFieldInputIds;
  isEditing: boolean;
  onChange: (patch: Partial<EquipmentDocumentFields>) => void;
  ready: boolean;
  typeOptions: ReadonlyArray<EquipmentTypeOption>;
}) {
  const {
    ariaLabelPrefix,
    disabled = false,
    fields,
    inputIds,
    isEditing,
    onChange,
    ready,
    typeOptions,
  } = params;
  const typeLabel = getEquipmentTypeLabel(typeOptions, fields.equipmentType);

  if (!isEditing) {
    return (
      <StructuredDocumentReadFields
        fields={[
          {
            displayValue: typeLabel.length > 0 ? typeLabel : undefined,
            label: "Type",
            value: fields.equipmentType,
          },
          { label: "Make", value: fields.make },
          { label: "Model", value: fields.model },
          { label: "Serial Number", value: fields.serialNumber },
        ]}
      />
    );
  }

  // A stored type outside this client's option list stays selectable as
  // itself, so opening the editor never silently reverts it to the placeholder.
  const hasUnlistedType =
    fields.equipmentType.length > 0 &&
    !typeOptions.some((option) => option.value === fields.equipmentType);

  return (
    <StructuredDocumentFields>
      <StructuredDocumentField inputId={inputIds.equipmentType} label="Type">
        <select
          id={inputIds.equipmentType}
          aria-label={`${ariaLabelPrefix} type`}
          value={fields.equipmentType}
          onChange={(event) => onChange({ equipmentType: event.target.value })}
          disabled={disabled}
        >
          <option value="">{ready ? "Select a type" : "Loading..."}</option>
          {hasUnlistedType ? (
            <option value={fields.equipmentType}>{typeLabel}</option>
          ) : null}
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </StructuredDocumentField>
      <StructuredDocumentField inputId={inputIds.make} label="Make">
        <input
          id={inputIds.make}
          aria-label={`${ariaLabelPrefix} make`}
          value={fields.make}
          onChange={(event) => onChange({ make: event.target.value })}
          placeholder={ready ? "Bosch" : "Loading..."}
          disabled={disabled}
          autoComplete="off"
        />
      </StructuredDocumentField>
      <StructuredDocumentField inputId={inputIds.model} label="Model">
        <input
          id={inputIds.model}
          aria-label={`${ariaLabelPrefix} model`}
          value={fields.model}
          onChange={(event) => onChange({ model: event.target.value })}
          placeholder={ready ? "SHPM88Z75N" : "Loading..."}
          disabled={disabled}
          autoComplete="off"
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.serialNumber}
        label="Serial Number"
      >
        <input
          id={inputIds.serialNumber}
          aria-label={`${ariaLabelPrefix} serial number`}
          value={fields.serialNumber}
          onChange={(event) => onChange({ serialNumber: event.target.value })}
          placeholder={ready ? "FD9912345678" : "Loading..."}
          disabled={disabled}
          autoComplete="off"
        />
      </StructuredDocumentField>
    </StructuredDocumentFields>
  );
}

export function EquipmentDocumentFieldsPane(params: {
  canWrite: boolean;
  definition: EquipmentDocumentTypeDefinition;
  fields: EquipmentDocumentFields;
  inputIds: EquipmentFieldInputIds;
  isEditing: boolean;
  onToggleEditing: () => void;
  ready: boolean;
  setStructuredFields: EquipmentStructuredFieldSetter;
}) {
  const { definition } = params;
  useStructuredDocumentEditAction({
    disabled: !params.ready || !params.canWrite,
    id: `${definition.kind}-toggle-edit`,
    isEditing: params.isEditing,
    onToggleEditing: params.onToggleEditing,
  });

  return (
    <EquipmentFields
      ariaLabelPrefix={definition.createLabel}
      disabled={!params.ready || !params.canWrite}
      fields={params.fields}
      inputIds={params.inputIds}
      isEditing={params.isEditing && params.canWrite}
      onChange={(patch) => {
        if (params.canWrite) {
          params.setStructuredFields(definition.kind, patch);
        }
      }}
      ready={params.ready}
      typeOptions={definition.typeOptions}
    />
  );
}

interface EquipmentDocumentProps {
  containerId: string | null;
  definition: EquipmentDocumentTypeDefinition;
  initialEditing?: boolean | undefined;
  localId: string;
}

function EquipmentDocument(params: EquipmentDocumentProps) {
  const { definition } = params;
  const doc = useAttachedStructuredDocument({
    containerId: params.containerId,
    documentLabel: definition.label,
    initialEditing: params.initialEditing,
    localId: params.localId,
    readFields: readEquipmentFields,
    slots: EQUIPMENT_ATTACHMENT_SLOTS,
  });
  const inputIds = {
    equipmentType: useId(),
    make: useId(),
    model: useId(),
    serialNumber: useId(),
  };
  return (
    <StructuredDocument
      attachments={
        <div className="equipment-attachment-slots">
          <DocumentAttachmentSlots {...doc.slotsProps} />
        </div>
      }
      fields={
        <EquipmentDocumentFieldsPane
          canWrite={doc.canWrite}
          definition={definition}
          fields={doc.fields}
          inputIds={inputIds}
          isEditing={doc.isEditing}
          onToggleEditing={doc.toggleEditing}
          ready={doc.ready}
          setStructuredFields={doc.setStructuredFields}
        />
      }
    />
  );
}

/**
 * The React app for one equipment kind: the shared document bound to that
 * kind's definition (its type options, labels, and untitled title).
 */
export function createEquipmentDocumentTypeApp(
  definition: EquipmentDocumentTypeDefinition,
): ComponentType<DocumentTypeAppProps> {
  function EquipmentDocumentType(params: {
    containerId: string | null;
    initialEditing?: boolean | undefined;
    localId: string;
  }) {
    return <EquipmentDocument {...params} definition={definition} />;
  }

  const App = createDocumentTypeApp(definition.kind, EquipmentDocumentType);
  App.displayName = `${definition.createLabel.replaceAll(/\s+/gu, "")}DocumentApp`;
  return App;
}
