import { useId, useMemo } from "react";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import {
  EYEGLASS_PRESCRIPTION_DOCUMENT_KIND,
  PRESCRIPTION_FIELDS,
  readPrescriptionFields,
} from "./eyeglassPrescriptionDocumentDefinition";

function EyeglassPrescription({
  initialEditing,
}: {
  initialEditing?: boolean | undefined;
}) {
  const id = useId();
  const { canWrite, ready, setStructuredFields, structuredFields } =
    useDocument();
  const { fields } = useMemo(
    () => readPrescriptionFields(structuredFields),
    [structuredFields],
  );
  const [isEditing, , toggleEditing] = useStructuredDocumentEditing(
    canWrite,
    initialEditing,
  );
  const disabled = !canWrite || !ready;
  useStructuredDocumentEditAction({
    disabled,
    id: "eyeglass-prescription-toggle-edit",
    isEditing,
    onToggleEditing: toggleEditing,
  });

  return (
    <StructuredDocument
      fields={
        isEditing && canWrite ? (
          <StructuredDocumentFields>
            {PRESCRIPTION_FIELDS.map(({ key, label, type }) => (
              <StructuredDocumentField
                key={key}
                inputId={`${id}-${key}`}
                label={label}
              >
                <input
                  id={`${id}-${key}`}
                  type={type}
                  value={fields[key] ?? ""}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={disabled}
                  onChange={(event) =>
                    setStructuredFields(EYEGLASS_PRESCRIPTION_DOCUMENT_KIND, {
                      [key]: event.target.value,
                    })
                  }
                />
              </StructuredDocumentField>
            ))}
          </StructuredDocumentFields>
        ) : (
          <StructuredDocumentReadFields
            fields={PRESCRIPTION_FIELDS.map(({ key, label }) => ({
              label,
              value: fields[key],
            }))}
          />
        )
      }
    />
  );
}

export const EyeglassPrescriptionDocumentApp = createDocumentTypeApp(
  EYEGLASS_PRESCRIPTION_DOCUMENT_KIND,
  EyeglassPrescription,
);
