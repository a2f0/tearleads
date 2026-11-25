import type { ComponentType } from "react";
import { useContext, useId } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import {
  DocumentContext,
  type useDocument,
} from "../../stores/documents/DocumentsProvider";
import type { DocumentTypeAppProps } from "../types";
import { DocumentAvatar } from "./avatar/DocumentAvatar";
import { createDocumentTypeApp } from "./createDocumentTypeApp";
import { DocumentAttachmentSlots } from "./DocumentAttachmentSlots";
import { DocumentFieldOptionSelect } from "./DocumentFieldOptionSelect";
import {
  type DocumentFieldOption,
  getDocumentFieldOptionLabel,
} from "./documentFieldOptions";
import { removeDocumentPhoto } from "./documentPhotos";
import {
  type EquipmentDocumentFields,
  type EquipmentDocumentTypeDefinition,
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
  typeOptions: ReadonlyArray<DocumentFieldOption>;
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
  const typeLabel = getDocumentFieldOptionLabel(
    typeOptions,
    fields.equipmentType,
  );

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

  return (
    <StructuredDocumentFields>
      <StructuredDocumentField inputId={inputIds.equipmentType} label="Type">
        <DocumentFieldOptionSelect
          ariaLabel={`${ariaLabelPrefix} type`}
          disabled={disabled}
          id={inputIds.equipmentType}
          onChange={(value) => onChange({ equipmentType: value })}
          options={typeOptions}
          placeholder={ready ? "Select a type" : "Loading..."}
          value={fields.equipmentType}
        />
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
  const { infra } = useTearleadsRuntime();
  const store = useContext(DocumentContext);
  const doc = useAttachedStructuredDocument({
    containerId: params.containerId,
    documentLabel: definition.label,
    initialEditing: params.initialEditing,
    localId: params.localId,
    readFields: readEquipmentFields,
    slots: definition.slots,
  });
  const inputIds = {
    equipmentType: useId(),
    make: useId(),
    model: useId(),
    serialNumber: useId(),
  };
  return (
    <StructuredDocument
      leading={
        <DocumentAvatar
          definition={definition}
          displayName={
            [doc.fields.make, doc.fields.model].filter(Boolean).join(" ") ||
            definition.createLabel
          }
          isEditing={doc.isEditing}
          imageUrlBySlotId={doc.slotsProps.imageUrlBySlotId}
          blobStore={infra.blobStore}
        />
      }
      attachments={
        <DocumentAttachmentSlots
          {...doc.slotsProps}
          onClearAttachment={(slotId) => {
            if (store) removeDocumentPhoto(store, definition.photos, slotId);
          }}
        />
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
