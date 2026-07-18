import { useState } from "react";
import { MiniAppRowActionsButton } from "../../components/mini-app/MiniAppTable";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  DocumentRowDetailOverlay,
  type RowDetailField,
} from "../shared/DocumentRowDetail";
import { formatRowAttribution } from "../shared/rowAttribution";
import {
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_VALUE_FIELD,
} from "./envFileDocumentDefinition";
import {
  type EnvVariableRow,
  getEnvFileReadValue,
  getEnvFileVariableReadValue,
  shouldMaskEnvFileVariable,
} from "./envFileVariables";

// A single variable in read mode: the key/value cells (masking sensitive
// values), a kebab that opens the per-variable detail overlay, and the row's
// last-edit attribution line.
export function EnvFileVariableReadRow(params: {
  currentAuthorId: string | null;
  index: number;
  resolveRowWriter?: RowWriterResolver | undefined;
  variable: EnvVariableRow;
}) {
  const { currentAuthorId, index, resolveRowWriter, variable } = params;
  const [detailOpen, setDetailOpen] = useState(false);
  const keyTitle = variable.key.trim();
  const valueTitle = shouldMaskEnvFileVariable(variable)
    ? undefined
    : variable.value.trim();
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

  // Resolve a single cell's verified writer for the drill-down; null when the
  // cell's editor is unknown (attribution not synced) so the overlay omits it.
  const fieldWriter = (field: string): string | null =>
    resolveRowWriter?.(variable.fieldEditors[field] ?? null) ?? null;
  // The value stays masked in the detail too — the drill-down must never leak a
  // secret the read row hides.
  const detailFields: RowDetailField[] = [
    {
      label: "Key",
      value: variable.key,
      writerUserId: fieldWriter(ENV_FILE_VARIABLE_KEY_FIELD),
    },
    {
      label: "Value",
      value: getEnvFileVariableReadValue(variable),
      writerUserId: fieldWriter(ENV_FILE_VARIABLE_VALUE_FIELD),
    },
  ];

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
          <span
            className="env-file-variable-read-value"
            title={valueTitle && valueTitle.length > 0 ? valueTitle : undefined}
          >
            {getEnvFileVariableReadValue(variable)}
          </span>
        </span>
        <span className="env-file-variable-read-index">{index + 1}</span>
        <MiniAppRowActionsButton
          aria-expanded={detailOpen}
          aria-haspopup="dialog"
          aria-label={`Env variable ${index + 1} details`}
          className="env-file-variable-read-actions"
          onClick={() => setDetailOpen(true)}
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
