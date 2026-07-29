import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { useState } from "react";
import {
  MiniAppButton,
  MiniAppClipboardButton,
} from "../../components/mini-app/MiniAppLayout";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  DocumentRowDetailOverlay,
  type RowDetailField,
} from "../shared/DocumentRowDetail";
import { formatRowAttribution } from "../shared/rowAttribution";
import { TrackerReadActions } from "../shared/TrackerReadActions";
import {
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_VALUE_FIELD,
} from "./envFileDocumentDefinition";
import {
  type EnvVariableRow,
  getEnvFileReadValue,
  getEnvFileVariableReadValue,
} from "./envFileVariables";

// A single variable in read mode: masked key/value cells, value controls, a
// kebab that opens the per-variable detail overlay, and the last-edit byline.
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
  const [isValueRevealed, setIsValueRevealed] = useState(false);
  const keyTitle = variable.key.trim();
  const hasValue = variable.value.trim().length > 0;
  const valueTitle = isValueRevealed ? variable.value.trim() : undefined;
  const valueLabel = `Env variable ${index + 1} value`;
  const revealAction = `${isValueRevealed ? "Hide" : "Show"} ${valueLabel}`;
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
  // The detail remains masked; revealing a value is an explicit, local action.
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
          <span className="env-file-variable-read-value-with-actions">
            <span
              className="env-file-variable-read-value"
              title={
                valueTitle && valueTitle.length > 0 ? valueTitle : undefined
              }
            >
              {getEnvFileVariableReadValue(variable, isValueRevealed)}
            </span>
            <span className="env-file-variable-read-value-actions">
              <MiniAppButton
                aria-label={revealAction}
                aria-pressed={isValueRevealed}
                className="mini-app-icon-button"
                disabled={!hasValue}
                onClick={() => setIsValueRevealed((revealed) => !revealed)}
                title={revealAction}
                variant="ghost"
              >
                {isValueRevealed ? (
                  <EyeSlashIcon aria-hidden size={16} />
                ) : (
                  <EyeIcon aria-hidden size={16} />
                )}
              </MiniAppButton>
              <MiniAppClipboardButton
                label={`Copy ${valueLabel}`}
                value={variable.value}
                variant="ghost"
              />
            </span>
          </span>
        </span>
        <span className="env-file-variable-read-index">{index + 1}</span>
        <TrackerReadActions
          actionsAriaLabel={`Env variable ${index + 1} actions`}
          className="env-file-variable-read-actions"
          detailLabel="Details"
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
