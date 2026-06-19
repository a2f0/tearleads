import { type ReactNode, useEffect, useId, useState } from "react";
import {
  MiniAppClipboardButton,
  MiniAppInput,
  MiniAppTextarea,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  CONTACT_FIELD_DESCRIPTORS,
  CONTACT_FIELD_LABELS,
  type ContactFieldDescriptor,
  type ContactFieldKey,
  type ContactFieldValues,
} from "./contactFieldDescriptors";

type ContactFieldCommit = (key: ContactFieldKey, value: string) => void;

const COPY_USER_ID_LABEL = "Copy user ID";

function getReadValue(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : CONTACT_FIELD_LABELS.none;
}

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
        <MiniAppRowText muted title={trimmed.length > 0 ? trimmed : undefined}>
          {getReadValue(value)}
        </MiniAppRowText>
      </MiniAppRowStack>
      {action}
    </MiniAppRow>
  );
}

function ContactEditFieldRow({
  descriptor,
  onCommit,
  value,
}: {
  descriptor: ContactFieldDescriptor;
  onCommit: (value: string) => void;
  value: string;
}) {
  const inputId = useId();
  const [localValue, setLocalValue] = useSyncedFieldValue(value);
  const commitOnBlur = () => {
    if (localValue !== value) {
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
      />
    ) : (
      <MiniAppInput
        id={inputId}
        aria-label={descriptor.label}
        value={localValue}
        placeholder={descriptor.placeholder}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={commitOnBlur}
      />
    );

  return (
    <div className="mini-app-field">
      <label htmlFor={inputId}>{descriptor.label}</label>
      {descriptor.copyable ? (
        <div className="mini-app-field-control">
          {control}
          <MiniAppClipboardButton
            label={COPY_USER_ID_LABEL}
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
// callback that is fired (on blur) when an editable field changes.
export function ContactFields({
  isEditing,
  onFieldCommit,
  values,
}: {
  isEditing: boolean;
  onFieldCommit: ContactFieldCommit;
  values: ContactFieldValues;
}) {
  return (
    <>
      {CONTACT_FIELD_DESCRIPTORS.map((descriptor) => {
        const value = values[descriptor.key];
        if (isEditing) {
          return (
            <ContactEditFieldRow
              key={descriptor.key}
              descriptor={descriptor}
              value={value}
              onCommit={(nextValue) => onFieldCommit(descriptor.key, nextValue)}
            />
          );
        }

        return (
          <ContactReadFieldRow
            key={descriptor.key}
            action={
              descriptor.copyable ? (
                <MiniAppClipboardButton
                  label={COPY_USER_ID_LABEL}
                  value={value}
                />
              ) : undefined
            }
            label={descriptor.label}
            value={value}
          />
        );
      })}
    </>
  );
}
