import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { useState } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
import {
  TrackerInputField,
  TrackerRowActions,
} from "../shared/TrackerFormControls";
import {
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_NAME_PATTERN,
  ENV_FILE_VARIABLE_VALUE_FIELD,
  isValidEnvFileVariableName,
} from "./envFileDocumentDefinition";
import type { EnvVariableRow } from "./envFileVariables";

export type EnvVariableField =
  | typeof ENV_FILE_VARIABLE_KEY_FIELD
  | typeof ENV_FILE_VARIABLE_VALUE_FIELD;

export type UpdateEnvVariable = (
  id: string,
  field: EnvVariableField,
  value: string,
) => void;

export function EnvFileVariableEditRow(params: {
  controlsDisabled: boolean;
  index: number;
  onRemoveVariable: (id: string) => void;
  onSaveVariable: (id: string) => void;
  onUpdateVariable: UpdateEnvVariable;
  variable: EnvVariableRow;
}) {
  const {
    controlsDisabled,
    index,
    onRemoveVariable,
    onSaveVariable,
    onUpdateVariable,
    variable,
  } = params;
  const [isValueRevealed, setIsValueRevealed] = useState(false);
  const keyIsInvalid =
    variable.key.length > 0 && !isValidEnvFileVariableName(variable.key);
  const valueLabel = `Env variable ${index + 1} value`;
  const revealAction = `${isValueRevealed ? "Hide" : "Show"} ${valueLabel}`;

  return (
    <div className="env-file-variable-row tracker-edit-row">
      <TrackerInputField
        aria-invalid={keyIsInvalid ? "true" : undefined}
        aria-label={`Env variable ${index + 1} key`}
        autoCapitalize="off"
        autoComplete="off"
        className="env-file-variable-key-field"
        disabled={controlsDisabled}
        label="Key"
        onChange={(event) =>
          onUpdateVariable(
            variable.id,
            ENV_FILE_VARIABLE_KEY_FIELD,
            event.target.value,
          )
        }
        pattern={ENV_FILE_VARIABLE_NAME_PATTERN}
        placeholder="API_TOKEN"
        spellCheck={false}
        title="Use a POSIX variable name like API_TOKEN."
        value={variable.key}
      />
      <TrackerInputField
        action={
          <MiniAppButton
            aria-label={revealAction}
            aria-pressed={isValueRevealed}
            className="mini-app-icon-button"
            disabled={controlsDisabled || variable.value.length === 0}
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
        }
        aria-label={valueLabel}
        autoCapitalize="off"
        autoComplete="off"
        className="env-file-variable-value-field"
        disabled={controlsDisabled}
        label="Value"
        onChange={(event) =>
          onUpdateVariable(
            variable.id,
            ENV_FILE_VARIABLE_VALUE_FIELD,
            event.target.value,
          )
        }
        placeholder="secret"
        spellCheck={false}
        type={isValueRevealed ? "text" : "password"}
        value={variable.value}
      />
      <TrackerRowActions
        disabled={controlsDisabled}
        onRemove={() => onRemoveVariable(variable.id)}
        onSave={() => onSaveVariable(variable.id)}
        removeAriaLabel={`Remove env variable ${index + 1}`}
        saveAriaLabel={`Save env variable ${index + 1}`}
      />
    </div>
  );
}
