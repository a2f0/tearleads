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

export function TrackerRowActions(params: {
  disabled: boolean;
  onRemove: () => void;
  onSave: () => void;
  removeAriaLabel: string;
  saveAriaLabel: string;
}) {
  // Cell edits persist as they change; Save completes this row's edit state and
  // returns it to its read presentation without closing the surrounding form.
  const { disabled, onRemove, onSave, removeAriaLabel, saveAriaLabel } = params;

  return (
    <div className="tracker-row-actions">
      <MiniAppButton
        aria-label={saveAriaLabel}
        className="tracker-save-button"
        withIcon
        disabled={disabled}
        onClick={onSave}
        title={saveAriaLabel}
      >
        <CheckIcon aria-hidden size={14} />
        Save
      </MiniAppButton>
      <MiniAppButton
        aria-label={removeAriaLabel}
        className="tracker-remove-button"
        withIcon
        disabled={disabled}
        onClick={onRemove}
        title={removeAriaLabel}
      >
        <TrashIcon aria-hidden size={14} />
        Remove
      </MiniAppButton>
    </div>
  );
}
