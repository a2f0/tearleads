import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { useState } from "react";
import {
  MiniAppButton,
  MiniAppClipboardButton,
} from "../../components/mini-app/MiniAppLayout";
import {
  type EnvVariableRow,
  getEnvFileVariableReadValue,
} from "./envFileVariables";

/**
 * A variable's value in read mode: masked by default, with the controls that
 * reveal it locally or copy it whole. Whether it is revealed is this control's
 * own state — deliberately not the document's — so a value is never exposed by
 * anything but an explicit press, and never for more than one row at a time.
 *
 * Shared by the index table's value cell and the entry card the editor collapses
 * a saved row into, so both mask and reveal identically.
 */
export function EnvFileVariableReadValue(params: {
  index: number;
  variable: EnvVariableRow;
}) {
  const { index, variable } = params;
  const [isValueRevealed, setIsValueRevealed] = useState(false);
  const hasValue = variable.value.trim().length > 0;
  const valueTitle = isValueRevealed ? variable.value.trim() : undefined;
  const valueLabel = `Env variable ${index + 1} value`;
  const revealAction = `${isValueRevealed ? "Hide" : "Show"} ${valueLabel}`;

  return (
    <span className="env-file-variable-read-value-with-actions">
      <span
        className="env-file-variable-read-value"
        title={valueTitle && valueTitle.length > 0 ? valueTitle : undefined}
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
  );
}
