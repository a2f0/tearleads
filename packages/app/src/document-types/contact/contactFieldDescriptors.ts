// Shared contact field metadata. Both the contacts mini-app and the explorer's
// contact document renderer drive their view/edit layouts off this list so the
// fields, labels, and ordering stay consistent across the two apps. A
// contact's Tearleads user ID and keys stay stored but are not shown; its
// identity link is offered from the contact's menu instead.

export type ContactFieldKey = "nickname" | "firstName" | "lastName";

export interface ContactFieldDescriptor {
  key: ContactFieldKey;
  label: string;
}

// A normalized, presentation-only view of a contact: every field is a plain
// string (empty string for "no value") so the shared layout never has to reason
// about null vs. undefined. Each consumer maps its own model into this shape.
export type ContactFieldValues = Record<ContactFieldKey, string>;

export const CONTACT_FIELD_LABELS = {
  firstName: "First name",
  lastName: "Last name",
  nickname: "Nickname",
  noDetails: "No details yet.",
} as const;

export const CONTACT_FIELD_DESCRIPTORS: readonly ContactFieldDescriptor[] = [
  { key: "nickname", label: CONTACT_FIELD_LABELS.nickname },
  { key: "firstName", label: CONTACT_FIELD_LABELS.firstName },
  { key: "lastName", label: CONTACT_FIELD_LABELS.lastName },
];
