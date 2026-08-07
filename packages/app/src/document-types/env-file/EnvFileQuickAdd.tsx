import { TrackerInputField } from "../shared/TrackerFormControls";
import { TrackerQuickAdd } from "../shared/TrackerQuickAdd";
import type { AddTrackerRow } from "../shared/useSavedTrackerRows";
import { EnvFileValueField } from "./EnvFileValueField";
import {
  ENV_FILE_VARIABLE_NAME_PATTERN,
  isValidEnvFileVariableName,
} from "./envFileDocumentDefinition";

export interface EnvFileQuickVariable {
  key: string;
  value: string;
}

const EMPTY_VARIABLE: EnvFileQuickVariable = { key: "", value: "" };

export function EnvFileQuickAdd(params: {
  controlsDisabled: boolean;
  onAddVariable: AddTrackerRow<EnvFileQuickVariable>;
  onPendingChange: (pending: boolean) => void;
}) {
  const { controlsDisabled, onAddVariable, onPendingChange } = params;

  return (
    <TrackerQuickAdd
      addLabel="Add Variable"
      className="env-file-variable-row"
      controlsDisabled={controlsDisabled}
      emptyEntry={EMPTY_VARIABLE}
      isValid={(variable) => isValidEnvFileVariableName(variable.key)}
      onAddEntry={onAddVariable}
      onPendingChange={onPendingChange}
      renderFields={(variable, onChange) => {
        const valid = isValidEnvFileVariableName(variable.key);
        return (
          <>
            <TrackerInputField
              aria-invalid={
                variable.key.length > 0 && !valid ? "true" : undefined
              }
              aria-label="Quick add env variable key"
              autoCapitalize="off"
              autoComplete="off"
              className="env-file-variable-key-field"
              disabled={controlsDisabled}
              label="Key"
              onChange={(event) => onChange("key", event.target.value)}
              pattern={ENV_FILE_VARIABLE_NAME_PATTERN}
              placeholder="API_TOKEN"
              spellCheck={false}
              title="Use a POSIX variable name like API_TOKEN."
              value={variable.key}
            />
            <EnvFileValueField
              ariaLabel="Quick add env variable value"
              disabled={controlsDisabled}
              onChange={(event) => onChange("value", event.target.value)}
              value={variable.value}
            />
          </>
        );
      }}
      saveLabel="Save Variable"
    />
  );
}
