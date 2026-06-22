import type {
  ContainerSystemSlotDefinition,
  StoredDocumentKind,
} from "@tearleads/client-sdk";

export const CONTACTS_CONTAINER_NAME = "Contacts";
export const CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION: ContainerSystemSlotDefinition =
  {
    namespace: "tearleads.contacts",
    projectorId: "contact",
    slotId: "contacts",
    version: 1,
  };

export const EXPLORER_TRASH_CONTAINER_NAME = "Trash";
const EXPLORER_TRASH_CONTAINER_SYSTEM_SLOT_DEFINITION: ContainerSystemSlotDefinition =
  {
    namespace: "tearleads.explorer",
    projectorId: "explorer",
    slotId: "trash",
    version: 1,
  };

export type UserSystemContainerKind = "contacts" | "trash";

// Rules that govern what a user may do to a system container and the documents
// it holds. Boolean flags default to `true` (the rule is enforced); flip one to
// `false` in a container's definition to disable that rule for everyone.
export interface UserSystemContainerRules {
  // Block moving this container under a different parent.
  readonly protectFromMove: boolean;
  // Block deleting this container.
  readonly protectFromDelete: boolean;
  // Block renaming this container.
  readonly protectFromRename: boolean;
  // Block moving documents out of this container (e.g. contacts must stay in
  // the Contacts container). Documents may still be deleted (moved to trash).
  readonly protectContentsFromLeaving: boolean;
  // Block uploading files directly into this container. System folders are
  // populated by the app (e.g. trash receives deleted items, contacts receives
  // contact documents), never by direct user upload.
  readonly protectFromUpload: boolean;
  // Restrict document kinds that may be linked or moved into this container.
  // `null` means the container accepts every document kind.
  readonly acceptedDocumentKinds: ReadonlyArray<StoredDocumentKind> | null;
  // Block deleting the builtin self ("You") contact that lives in this
  // container. Only meaningful for the contacts container.
  readonly protectSelfDocumentFromDelete: boolean;
}

interface UserSystemContainerDefinition {
  readonly kind: UserSystemContainerKind;
  readonly name: string;
  readonly rules: UserSystemContainerRules;
  readonly slotDefinition: ContainerSystemSlotDefinition;
  // Whether this system folder stays visible when its parent root is shared
  // with another user. A peer's system slots are HMAC'd from the owner's key,
  // so they never match the viewer's own slots — the explorer falls back to the
  // container name to decide. Contacts are meant to be shared; Trash is private.
  readonly visibleWhenShared: boolean;
}

export const USER_SYSTEM_CONTAINER_DEFINITIONS: readonly UserSystemContainerDefinition[] =
  [
    {
      kind: "contacts",
      name: CONTACTS_CONTAINER_NAME,
      rules: {
        protectFromMove: true,
        protectFromDelete: true,
        protectFromRename: true,
        protectContentsFromLeaving: true,
        protectSelfDocumentFromDelete: true,
        protectFromUpload: true,
        acceptedDocumentKinds: ["contact"],
      },
      slotDefinition: CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
      visibleWhenShared: true,
    },
    {
      kind: "trash",
      name: EXPLORER_TRASH_CONTAINER_NAME,
      rules: {
        protectFromMove: true,
        protectFromDelete: true,
        protectFromRename: true,
        // Trash is a destination, not a home: items are expected to leave it
        // (restore) freely, so its contents are not pinned.
        protectContentsFromLeaving: false,
        protectSelfDocumentFromDelete: false,
        protectFromUpload: true,
        acceptedDocumentKinds: null,
      },
      slotDefinition: EXPLORER_TRASH_CONTAINER_SYSTEM_SLOT_DEFINITION,
      visibleWhenShared: false,
    },
  ];

// Names of system folders that remain visible when viewed under another user's
// shared root. Used as the cross-user classifier since system slots are opaque
// per-owner HMACs and cannot be derived by a peer.
export const SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES = new Set(
  USER_SYSTEM_CONTAINER_DEFINITIONS.filter(
    (definition) => definition.visibleWhenShared,
  ).map((definition) => definition.name),
);

// Rules for the shareable system folders keyed by their name. A peer's system
// folder carries the owner's opaque HMAC slot, so its rules cannot be resolved
// by slot on the viewer's side — they are resolved by name instead (see
// resolveContainerRules). Only `visibleWhenShared` folders are included, so a
// peer's Trash never inherits system rules.
const SHARED_SYSTEM_CONTAINER_RULES_BY_NAME = new Map(
  USER_SYSTEM_CONTAINER_DEFINITIONS.filter(
    (definition) => definition.visibleWhenShared,
  ).map((definition) => [definition.name, definition.rules]),
);

export function getUserSystemContainerRulesByKind(
  kind: UserSystemContainerKind,
): UserSystemContainerRules | null {
  return (
    USER_SYSTEM_CONTAINER_DEFINITIONS.find(
      (definition) => definition.kind === kind,
    )?.rules ?? null
  );
}

// Resolve the rules for a shareable system folder by its name. Used for a peer's
// system folder under a shared root, whose owner-derived slot the viewer cannot
// match. Returns null for non-system names and for folders that are not shared
// (e.g. Trash).
export function getSharedSystemContainerRulesByName(
  name: string,
): UserSystemContainerRules | null {
  return SHARED_SYSTEM_CONTAINER_RULES_BY_NAME.get(name) ?? null;
}

// A container belongs to another organization's shared root (a peer's tree the
// viewer can see by membership) when it carries a different, valid organization
// than the viewer's own. The empty-org and null-current-org guards keep a
// same-org sibling — or a node seen before session hydration — from passing as
// shared, which is what prevents a same-org peer from spoofing a system folder
// name to fabricate rules or system status. Mirrors the visibility classifier in
// ExplorerSystemContainers so the two never diverge.
export function isUnderForeignSharedRoot(input: {
  currentOrganizationId: string | null | undefined;
  organizationId: string;
}): boolean {
  return (
    input.currentOrganizationId != null &&
    input.organizationId !== "" &&
    input.organizationId !== input.currentOrganizationId
  );
}
