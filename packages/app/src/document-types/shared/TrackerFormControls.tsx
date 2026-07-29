import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { InputHTMLAttributes, ReactNode } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
} from "../../components/mini-app/MiniAppLayout";
import { classNames } from "../../components/shared/classNames";
import "./TrackerFormControls.css";

type TrackerInputFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "className"
> & {
  className?: string | undefined;
  label: ReactNode;
};

export function TrackerInputField({
  className,
  label,
  ...inputProps
}: TrackerInputFieldProps) {
  return (
    <MiniAppField className={classNames("tracker-entry-field", className)}>
      <span>{label}</span>
      <MiniAppInput {...inputProps} />
    </MiniAppField>
  );
}

export function TrackerRemoveAction(params: {
  ariaLabel: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { ariaLabel, disabled, onRemove } = params;

  return (
    <div className="tracker-row-actions">
      <MiniAppButton
        aria-label={ariaLabel}
        className="tracker-remove-button"
        withIcon
        disabled={disabled}
        onClick={onRemove}
        title={ariaLabel}
      >
        <TrashIcon aria-hidden size={14} />
        Remove
      </MiniAppButton>
    </div>
  );
}

export function TrackerSaveAction(params: {
  disabled: boolean;
  onSave: () => void;
}) {
  const { disabled, onSave } = params;

  return (
    <div className="tracker-save-actions">
      <MiniAppButton withIcon disabled={disabled} onClick={onSave}>
        <CheckIcon aria-hidden size={14} />
        Save
      </MiniAppButton>
    </div>
  );
}
