import { useMemo } from "react";
import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import {
  StructuredDocument,
  useStructuredDocumentEditAction,
} from "../shared/StructuredDocument";
import { useTrackerDocument } from "../shared/useTrackerDocument";
import { PasscodeEditView } from "./PasscodeEditView";
import { PasscodeReadView } from "./PasscodeReadView";
import { toPasscodeAttributes } from "./passcodeAttributes";
import {
  PASSCODE_DOCUMENT_KIND,
  type PasscodeDocumentFields,
  readPasscodeFieldValues,
} from "./passcodeDocumentDefinition";
import "./Passcode.css";

function Passcode(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const tracker = useTrackerDocument(params.initialEditing);
  const fields = useMemo(
    () => readPasscodeFieldValues(tracker.structuredFields),
    [tracker.structuredFields],
  );
  const attributes = toPasscodeAttributes(tracker.rows, tracker.readCell);
  const controlsDisabled = !tracker.ready || !tracker.canWrite;
  const isEditing = tracker.isEditing && tracker.canWrite;
  useStructuredDocumentEditAction({
    disabled: controlsDisabled,
    id: "passcode-toggle-edit",
    isEditing,
    onToggleEditing: tracker.toggleEditing,
  });

  return (
    <StructuredDocument
      fields={
        <div className="passcode">
          {isEditing ? (
            <PasscodeEditView
              attributeOperations={tracker}
              attributes={attributes}
              disabled={controlsDisabled}
              fields={fields}
              onChange={(patch: Partial<PasscodeDocumentFields>) =>
                tracker.setFields(PASSCODE_DOCUMENT_KIND, patch)
              }
              ready={tracker.ready}
            />
          ) : (
            <PasscodeReadView attributes={attributes} fields={fields} />
          )}
        </div>
      }
    />
  );
}

export const PasscodeDocumentApp = createDocumentTypeApp(
  PASSCODE_DOCUMENT_KIND,
  Passcode,
);
