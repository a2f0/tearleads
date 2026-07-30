import { useState } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { DocumentRowDetailOverlay } from "../shared/DocumentRowDetail";
import { formatRowAttribution } from "../shared/rowAttribution";
import { TrackerReadActions } from "../shared/TrackerReadActions";
import { EnvFileVariableReadValue } from "./EnvFileVariableReadValue";
import {
  type EnvVariableRow,
  getEnvFileReadValue,
  toEnvVariableDetailFields,
} from "./envFileVariables";

// One saved variable as a card, which is how the editor collapses a row the user
// has finished with: masked key/value cells, the value controls, a kebab that
// opens the per-variable detail overlay, and the last-edit byline. Read mode
// presents the same variables as a sortable table instead — see EnvFileReadTable.
export function EnvFileVariableReadRow(params: {
  currentAuthorId: string | null;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
  variable: EnvVariableRow;
}) {
  const { currentAuthorId, index, onEnterEdit, resolveRowWriter, variable } =
    params;
  const [detailOpen, setDetailOpen] = useState(false);
  const keyTitle = variable.key.trim();
  // Prefer the server-verified writer of this variable's last edit; fall back to
  // the row's self-attested author when attribution is unavailable.
  const updatedBy =
    resolveRowWriter?.(variable.updatedByPeer) ?? variable.updatedBy;
  const createdBy =
    resolveRowWriter?.(variable.createdByPeer) ?? variable.createdBy;
  const attribution = formatRowAttribution({
    currentAuthorId,
    updatedAt: variable.updatedAt,
    updatedBy,
  });
  const detailFields = toEnvVariableDetailFields(variable, resolveRowWriter);

  return (
    <>
      <div className="env-file-variable-read-row">
        <span className="env-file-variable-read-cell">
          <strong>Key</strong>
          <span
            className="env-file-variable-read-value"
            title={keyTitle.length > 0 ? keyTitle : undefined}
          >
            {getEnvFileReadValue(variable.key)}
          </span>
        </span>
        <span className="env-file-variable-read-cell">
          <strong>Value</strong>
          <EnvFileVariableReadValue index={index} variable={variable} />
        </span>
        <span className="env-file-variable-read-index">{index + 1}</span>
        <TrackerReadActions
          actionsAriaLabel={`Env variable ${index + 1} actions`}
          className="env-file-variable-read-actions"
          detailLabel="Details"
          detailsOpen={detailOpen}
          directAriaLabel={`Env variable ${index + 1} details`}
          onEnterEdit={onEnterEdit}
          onOpenDetails={() => setDetailOpen(true)}
        />
        {attribution ? (
          <span className="env-file-variable-read-attribution">
            {attribution}
          </span>
        ) : null}
      </div>
      {detailOpen ? (
        <DocumentRowDetailOverlay
          createdAt={variable.createdAt}
          createdBy={createdBy}
          currentAuthorId={currentAuthorId}
          fields={detailFields}
          onClose={() => setDetailOpen(false)}
          title={keyTitle.length > 0 ? keyTitle : `Variable ${index + 1}`}
          updatedAt={variable.updatedAt}
          updatedBy={updatedBy}
        />
      ) : null}
    </>
  );
}
