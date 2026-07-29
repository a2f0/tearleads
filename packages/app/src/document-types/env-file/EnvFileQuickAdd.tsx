import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type FormEvent, useEffect, useState } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
import { TrackerInputField } from "../shared/TrackerFormControls";
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
  onAddVariable: (variable: EnvFileQuickVariable) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { controlsDisabled, onAddVariable, onPendingChange } = params;
  const [open, setOpen] = useState(false);
  const [variable, setVariable] = useState(EMPTY_VARIABLE);
  const valid = isValidEnvFileVariableName(variable.key);

  useEffect(
    () => () => {
      onPendingChange(false);
    },
    [onPendingChange],
  );

  function close() {
    setVariable(EMPTY_VARIABLE);
    setOpen(false);
    onPendingChange(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controlsDisabled || !valid) {
      return;
    }
    onAddVariable(variable);
    close();
  }

  if (!open) {
    return (
      <MiniAppButton
        className="env-file-add-button tracker-add-button"
        withIcon
        disabled={controlsDisabled}
        onClick={() => {
          setOpen(true);
          onPendingChange(true);
        }}
      >
        <PlusIcon aria-hidden size={14} />
        Add Variable
      </MiniAppButton>
    );
  }

  return (
    <form className="env-file-variable-row tracker-edit-row" onSubmit={submit}>
      <TrackerInputField
        aria-invalid={variable.key.length > 0 && !valid ? "true" : undefined}
        aria-label="Quick add env variable key"
        autoCapitalize="off"
        autoComplete="off"
        className="env-file-variable-key-field"
        disabled={controlsDisabled}
        label="Key"
        onChange={(event) =>
          setVariable((current) => ({
            ...current,
            key: event.target.value,
          }))
        }
        pattern={ENV_FILE_VARIABLE_NAME_PATTERN}
        placeholder="API_TOKEN"
        spellCheck={false}
        title="Use a POSIX variable name like API_TOKEN."
        value={variable.key}
      />
      <TrackerInputField
        aria-label="Quick add env variable value"
        autoCapitalize="off"
        autoComplete="off"
        className="env-file-variable-value-field"
        disabled={controlsDisabled}
        label="Value"
        onChange={(event) =>
          setVariable((current) => ({
            ...current,
            value: event.target.value,
          }))
        }
        placeholder="secret"
        spellCheck={false}
        value={variable.value}
      />
      <div className="env-file-quick-add-actions tracker-quick-add-actions">
        <MiniAppButton
          withIcon
          disabled={controlsDisabled || !valid}
          type="submit"
        >
          <CheckIcon aria-hidden size={14} />
          Save Variable
        </MiniAppButton>
        <MiniAppButton withIcon disabled={controlsDisabled} onClick={close}>
          <XIcon aria-hidden size={14} />
          Cancel
        </MiniAppButton>
      </div>
    </form>
  );
}
