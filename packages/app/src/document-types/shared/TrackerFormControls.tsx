import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppFieldGroup,
  MiniAppInput,
} from "../../components/mini-app/MiniAppLayout";
import { classNames } from "../../components/shared/classNames";
import "./TrackerFormControls.css";

type TrackerInputFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "className"
> & {
  action?: ReactNode | undefined;
  className?: string | undefined;
  label: ReactNode;
};

export function TrackerInputField({
  action,
  className,
  label,
  ...inputProps
}: TrackerInputFieldProps) {
  const generatedInputId = useId();
  const inputId = inputProps.id ?? generatedInputId;

  if (action) {
    // Interactive trailing controls must be siblings of the label. Nesting a
    // button inside a label is invalid and redirects its click to the input.
    return (
      <MiniAppFieldGroup
        className={classNames("tracker-entry-field", className)}
      >
        <label htmlFor={inputId}>{label}</label>
        <span className="tracker-entry-field-control">
          <MiniAppInput {...inputProps} id={inputId} />
          <span className="tracker-entry-field-actions">{action}</span>
        </span>
      </MiniAppFieldGroup>
    );
  }

  return (
    <MiniAppField className={classNames("tracker-entry-field", className)}>
      <span>{label}</span>
      <MiniAppInput {...inputProps} id={inputId} />
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
