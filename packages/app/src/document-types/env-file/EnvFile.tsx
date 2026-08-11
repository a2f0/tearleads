import { useId } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { StructuredDocument } from "../shared/StructuredDocument";
import { TrackerDocument } from "../shared/TrackerDocument";
import { TrackerNameEditFields } from "../shared/TrackerNameEditFields";
import { readStructuredTrackerField } from "../shared/trackerRows";
import type { AddTrackerRow } from "../shared/useSavedTrackerRows";
import { useTrackerDocument } from "../shared/useTrackerDocument";
import {
  EnvFileVariableEditRow,
  type UpdateEnvVariable,
} from "./EnvFileEditRow";
import { EnvFileQuickAdd, type EnvFileQuickVariable } from "./EnvFileQuickAdd";
import { EnvFileReadTable } from "./EnvFileReadTable";
import { EnvFileVariableReadRow } from "./EnvFileVariableReadRow";
import {
  ENV_FILE_DOCUMENT_KIND,
  ENV_FILE_NAME_FIELD,
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_VALUE_FIELD,
} from "./envFileDocumentDefinition";
import { type EnvVariableRow, toEnvVariableRows } from "./envFileVariables";
import "./EnvFile.css";

interface EnvFileFieldsProps {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  editingVariableId?: string | null | undefined;
  fileName: string;
  fileNameInputId: string;
  isEditing?: boolean | undefined;
  onAddVariable: AddTrackerRow<EnvFileQuickVariable>;
  onEnterEdit?: ((id: string) => void) | undefined;
  onRemoveVariable: (id: string) => void;
  onRenameFile: (value: string) => void;
  onToggleEditing: () => void;
  onUpdateVariable: UpdateEnvVariable;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  variables: ReadonlyArray<EnvVariableRow>;
}

export function EnvFileFields(params: EnvFileFieldsProps) {
  return (
    <TrackerDocument
      currentAuthorId={params.currentAuthorId ?? null}
      disabled={params.disabled ?? false}
      editingRowId={params.editingVariableId ?? null}
      editActionId="env-file-toggle-edit"
      emptyLabel="No variables"
      isEditing={params.isEditing ?? true}
      listLabel="Variables"
      onAddRow={params.onAddVariable}
      onEnterEdit={params.onEnterEdit}
      onToggleEditing={params.onToggleEditing}
      ready={params.ready}
      renderEditFields={(controlsDisabled) => (
        <TrackerNameEditFields
          ariaLabel=".env file name"
          controlsDisabled={controlsDisabled}
          inputId={params.fileNameInputId}
          label="File Name"
          onRename={params.onRenameFile}
          placeholder=".env"
          ready={params.ready}
          value={params.fileName}
        />
      )}
      renderEditRow={(variable, index, context) => (
        <EnvFileVariableEditRow
          controlsDisabled={context.controlsDisabled}
          index={index}
          onRemoveVariable={params.onRemoveVariable}
          onSaveVariable={context.onSave}
          onUpdateVariable={params.onUpdateVariable}
          variable={variable}
        />
      )}
      renderQuickAdd={(context) => (
        <EnvFileQuickAdd
          controlsDisabled={context.controlsDisabled}
          onAddVariable={context.onAddRow}
          onPendingChange={context.onPendingChange}
        />
      )}
      renderReadRow={(variable, index, _rows, context) => (
        <EnvFileVariableReadRow
          currentAuthorId={context.currentAuthorId}
          index={index}
          onEnterEdit={context.onEnterEdit}
          resolveRowWriter={context.resolveRowWriter}
          variable={variable}
        />
      )}
      renderReadTable={(context) => (
        <EnvFileReadTable
          currentAuthorId={context.currentAuthorId}
          onEnterEdit={context.onEnterEdit}
          resolveRowWriter={context.resolveRowWriter}
          variables={params.variables}
        />
      )}
      resolveRowWriter={params.resolveRowWriter}
      rows={params.variables}
    />
  );
}

export function EnvFile(params: { initialEditing?: boolean | undefined }) {
  const tracker = useTrackerDocument(params.initialEditing);
  const fileName = readStructuredTrackerField(
    tracker.structuredFields,
    ENV_FILE_NAME_FIELD,
  );
  const variables = toEnvVariableRows(tracker.rows, tracker.readCell);
  const fileNameInputId = useId();

  return (
    <StructuredDocument
      fields={
        <EnvFileFields
          currentAuthorId={tracker.currentAuthorId}
          disabled={!tracker.ready || !tracker.canWrite}
          editingVariableId={tracker.editingRowId}
          fileName={fileName}
          fileNameInputId={fileNameInputId}
          isEditing={tracker.isEditing && tracker.canWrite}
          onAddVariable={(variable) =>
            tracker.addRow({
              [ENV_FILE_VARIABLE_KEY_FIELD]: variable.key,
              [ENV_FILE_VARIABLE_VALUE_FIELD]: variable.value,
            })
          }
          onEnterEdit={tracker.enterRowEdit}
          onRemoveVariable={tracker.removeRow}
          onRenameFile={(value) =>
            tracker.setFields(ENV_FILE_DOCUMENT_KIND, {
              [ENV_FILE_NAME_FIELD]: value,
            })
          }
          onToggleEditing={tracker.toggleEditing}
          onUpdateVariable={tracker.updateRow}
          ready={tracker.ready}
          resolveRowWriter={tracker.resolveRowWriter}
          variables={variables}
        />
      }
    />
  );
}
