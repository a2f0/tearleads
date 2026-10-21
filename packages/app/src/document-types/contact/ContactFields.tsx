import { type ReactNode, useEffect, useId, useState } from "react";
import {
  MiniAppClipboardButton,
  MiniAppInput,
  MiniAppStatus,
  MiniAppTextarea,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import {
  CONTACT_FIELD_DESCRIPTORS,
  CONTACT_FIELD_LABELS,
  type ContactFieldDescriptor,
  type ContactFieldKey,
  type ContactFieldValues,
  getContactCopyLabel,
} from "./contactFieldDescriptors";

type ContactFieldCommit = (key: ContactFieldKey, value: string) => void;

function useSyncedFieldValue(value: string) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return [localValue, setLocalValue] as const;
}

function ContactReadFieldRow({
  action,
  label,
  value,
}: {
  action?: ReactNode | undefined;
  label: string;
  value: string;
}) {
  const trimmed = value.trim();
  return (
    <MiniAppRow density="roomy">
      <MiniAppRowStack>
        <strong>{label}</strong>
        <MiniAppRowText muted title={trimmed}>
          {trimmed}
        </MiniAppRowText>
      </MiniAppRowStack>
      {action}
    </MiniAppRow>
  );
}

function ContactEditFieldRow({
  descriptor,
  disabled,
  onCommit,
  value,
}: {
  descriptor: ContactFieldDescriptor;
  disabled?: boolean | undefined;
  onCommit: (value: string) => void;
  value: string;
}) {
  const inputId = useId();
  const [localValue, setLocalValue] = useSyncedFieldValue(value);
  const commitOnBlur = () => {
    if (!disabled && localValue !== value) {
      onCommit(localValue);
    }
  };

  const control =
    descriptor.control === "textarea" ? (
      <MiniAppTextarea
        id={inputId}
        aria-label={descriptor.label}
        value={localValue}
        placeholder={descriptor.placeholder}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={commitOnBlur}
        disabled={disabled}
      />
    ) : (
      <MiniAppInput
        id={inputId}
        aria-label={descriptor.label}
        value={localValue}
        placeholder={descriptor.placeholder}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={commitOnBlur}
        disabled={disabled}
      />
    );

  return (
    <div className="mini-app-field">
      <label htmlFor={inputId}>{descriptor.label}</label>
      {descriptor.copyable ? (
        <div className="mini-app-field-control">
          {control}
          <MiniAppClipboardButton
            label={getContactCopyLabel(descriptor)}
            value={localValue}
          />
        </div>
      ) : (
        control
      )}
    </div>
  );
}

// Shared contact field layout used by both the contacts mini-app and the
// explorer's contact document renderer. It is intentionally unaware of how a
// contact is stored: callers pass a normalized value map and an `onFieldCommit`
// callback that is fired (on blur) when an editable field changes. While
// editing, `disabled` greys out the inputs without leaving edit mode, so a
// transient not-ready state (e.g. a background sync) never discards unsaved
// local edits by unmounting the fields. Reading shows only filled-in fields;
// editing shows every field so an empty one can be filled in.
export function ContactFields({
  disabled,
  isEditing,
  onFieldCommit,
  values,
}: {
  disabled?: boolean | undefined;
  isEditing: boolean;
  onFieldCommit: ContactFieldCommit;
  values: ContactFieldValues;
}) {
  if (isEditing) {
    return (
      <>
        {CONTACT_FIELD_DESCRIPTORS.map((descriptor) => (
          <ContactEditFieldRow
            key={descriptor.key}
            descriptor={descriptor}
            disabled={disabled}
            value={values[descriptor.key]}
            onCommit={(nextValue) => onFieldCommit(descriptor.key, nextValue)}
          />
        ))}
      </>
    );
  }

  const filled = CONTACT_FIELD_DESCRIPTORS.filter(
    (descriptor) => values[descriptor.key].trim().length > 0,
  );
  if (filled.length === 0) {
    return <MiniAppStatus>{CONTACT_FIELD_LABELS.noDetails}</MiniAppStatus>;
  }
  return (
    <>
      {filled.map((descriptor) => (
        <ContactReadFieldRow
          key={descriptor.key}
          action={
            descriptor.copyable ? (
              <MiniAppClipboardButton
                label={getContactCopyLabel(descriptor)}
                value={values[descriptor.key]}
              />
            ) : undefined
          }
          label={descriptor.label}
          value={values[descriptor.key]}
        />
      ))}
    </>
  );
}
