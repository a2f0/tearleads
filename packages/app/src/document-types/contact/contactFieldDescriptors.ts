// Shared contact field metadata. Both the contacts mini-app and the explorer's
// contact document renderer drive their view/edit layouts off this list so the
// fields, labels, and ordering stay consistent across the two apps.

export type ContactFieldKey =
  | "nickname"
  | "firstName"
  | "lastName"
  | "userId"
  | "encapsulationPublicKey";

export type ContactFieldControl = "input" | "textarea";

export interface ContactFieldDescriptor {
  /** Whether the field offers a copy-to-clipboard action. */
  copyable: boolean;
  /** Accessible label for the copy action; defaults to `Copy <label>`. */
  copyLabel?: string;
  control: ContactFieldControl;
  key: ContactFieldKey;
  label: string;
  /** Placeholder shown for empty optional fields while editing. */
  placeholder?: string;
}

export function getContactCopyLabel(
  descriptor: ContactFieldDescriptor,
): string {
  return descriptor.copyLabel ?? `Copy ${descriptor.label}`;
}

// A normalized, presentation-only view of a contact: every field is a plain
// string (empty string for "no value") so the shared layout never has to reason
// about null vs. undefined. Each consumer maps its own model into this shape.
export type ContactFieldValues = Record<ContactFieldKey, string>;

export const CONTACT_FIELD_LABELS = {
  encapsulationPublicKey: "Public key",
  firstName: "First name",
  lastName: "Last name",
  nickname: "Nickname",
  none: "None",
  userId: "SymCrypt user ID",
} as const;

const OPTIONAL_PLACEHOLDER = "Optional";

export const CONTACT_FIELD_DESCRIPTORS: readonly ContactFieldDescriptor[] = [
  {
    copyable: false,
    control: "input",
    key: "nickname",
    label: CONTACT_FIELD_LABELS.nickname,
  },
  {
    copyable: false,
    control: "input",
    key: "firstName",
    label: CONTACT_FIELD_LABELS.firstName,
  },
  {
    copyable: false,
    control: "input",
    key: "lastName",
    label: CONTACT_FIELD_LABELS.lastName,
  },
  {
    copyable: true,
    copyLabel: "Copy user ID",
    control: "input",
    key: "userId",
    label: CONTACT_FIELD_LABELS.userId,
    placeholder: OPTIONAL_PLACEHOLDER,
  },
  {
    copyable: false,
    control: "textarea",
    key: "encapsulationPublicKey",
    label: CONTACT_FIELD_LABELS.encapsulationPublicKey,
    placeholder: OPTIONAL_PLACEHOLDER,
  },
];
