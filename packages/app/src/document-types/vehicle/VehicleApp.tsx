import { useContext, useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { DocumentContext } from "../../stores/documents/DocumentsProvider";
import { DocumentAvatar } from "../shared/avatar/DocumentAvatar";
import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import { removeDocumentPhoto } from "../shared/documentPhotos";
import { RowLogDocument } from "../shared/RowLogDocument";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
} from "../shared/StructuredDocument";
import { useStructuredDocumentAttachments } from "../shared/useAttachedStructuredDocument";
import { useTrackerDocument } from "../shared/useTrackerDocument";
import {
  readVehicleFieldValues,
  VEHICLE_DOCUMENT_KIND,
  VEHICLE_FIELDS,
  VEHICLE_SLOTS,
  type VehicleDocumentFields,
  vehicleDocumentProjectorDefinition,
} from "./vehicleDocumentDefinition";
import { VEHICLE_SERVICE_LOG } from "./vehicleServiceLog";

/** The vehicle's own fields, read or edited. */
export function VehicleFields(params: {
  disabled: boolean;
  fields: VehicleDocumentFields;
  isEditing: boolean;
  onChange: (patch: Partial<VehicleDocumentFields>) => void;
  ready: boolean;
}) {
  const { disabled, fields, isEditing, onChange, ready } = params;
  const id = useId();

  if (!isEditing) {
    return (
      <StructuredDocumentReadFields
        fields={VEHICLE_FIELDS.map((field) => ({
          label: field.label,
          value: fields[field.key],
        }))}
      />
    );
  }

  return (
    <StructuredDocumentFields>
      {VEHICLE_FIELDS.map((field) => {
        const inputId = `${id}-${field.key}`;
        return (
          <StructuredDocumentField
            key={field.key}
            inputId={inputId}
            label={field.label}
          >
            <input
              id={inputId}
              type={"type" in field ? field.type : "text"}
              inputMode={"inputMode" in field ? field.inputMode : undefined}
              value={fields[field.key]}
              placeholder={
                ready
                  ? "placeholder" in field
                    ? field.placeholder
                    : undefined
                  : "Loading..."
              }
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  [field.key]:
                    field.key === "purchaseCurrency" || field.key === "vin"
                      ? event.target.value.toUpperCase()
                      : event.target.value,
                })
              }
            />
          </StructuredDocumentField>
        );
      })}
    </StructuredDocumentFields>
  );
}

function Vehicle(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const { infra } = useTearleadsRuntime();
  const store = useContext(DocumentContext);
  const tracker = useTrackerDocument(params.initialEditing);
  const fields = useMemo(
    () => readVehicleFieldValues(tracker.structuredFields),
    [tracker.structuredFields],
  );
  const slotsProps = useStructuredDocumentAttachments({
    containerId: params.containerId,
    documentLabel: "vehicle",
    isEditing: tracker.isEditing,
    localId: params.localId,
    slots: VEHICLE_SLOTS,
  });
  const fieldProps = {
    fields,
    onChange: (patch: Partial<VehicleDocumentFields>) =>
      tracker.setFields(VEHICLE_DOCUMENT_KIND, patch),
    ready: tracker.ready,
  };

  return (
    <StructuredDocument
      leading={
        <DocumentAvatar
          blobStore={infra.blobStore}
          definition={vehicleDocumentProjectorDefinition}
          displayName={
            [fields.make, fields.model].filter(Boolean).join(" ") || "Vehicle"
          }
          imageUrlBySlotId={slotsProps.imageUrlBySlotId}
          isEditing={tracker.isEditing}
        />
      }
      attachments={
        <DocumentAttachmentSlots
          {...slotsProps}
          onClearAttachment={(slotId) => {
            if (store) {
              removeDocumentPhoto(
                store,
                vehicleDocumentProjectorDefinition.photos,
                slotId,
              );
            }
          }}
        />
      }
      fields={
        <RowLogDocument
          definition={VEHICLE_SERVICE_LOG}
          editActionId="vehicle-toggle-edit"
          readSummary={
            <VehicleFields {...fieldProps} disabled isEditing={false} />
          }
          renderEditFields={(controlsDisabled) => (
            <VehicleFields
              {...fieldProps}
              disabled={controlsDisabled}
              isEditing
            />
          )}
          tracker={tracker}
        />
      }
    />
  );
}

export const VehicleDocumentApp = createDocumentTypeApp(
  VEHICLE_DOCUMENT_KIND,
  Vehicle,
);
