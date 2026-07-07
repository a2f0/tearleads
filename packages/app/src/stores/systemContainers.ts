import type {
  ContainerSystemSlotDefinition,
  ProvisionedSystemContainerSpec,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { deriveContainerSystemSlot } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";

export const CONTACTS_CONTAINER_NAME = "Contacts";
export const CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION: ContainerSystemSlotDefinition =
  {
    namespace: "tearleads.contacts",
    projectorId: "contact",
    slotId: "contacts",
    version: 1,
  };

export const EXPLORER_TRASH_CONTAINER_NAME = "Trash";
export const EXPLORER_TRASH_CONTAINER_ICON = "trash";
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
  // Block creating additional links from documents while they live in this
  // container. Trash uses this so a deleted item can only be restored/moved,
  // not spread to new folders from the trash bin.
  readonly protectContentsFromLinking: boolean;
  // Block uploading files directly into this container. System folders are
  // populated by the app (e.g. trash receives deleted items, contacts receives
  // contact documents), never by direct user upload.
  readonly protectFromUpload: boolean;
  // Block nesting user-created folders under this system container. Contacts
  // and Trash are app-managed buckets; allowing children there would blur the
  // boundary between system-owned content and normal user folders.
  readonly protectFromChildContainerCreation: boolean;
  // Block creating new structured documents directly inside this system
  // container. Existing documents still follow the move/link rules below.
  readonly protectFromStructuredDocumentCreation: boolean;
  // Restrict document kinds that may be linked or moved into this container.
  // `null` means the container accepts every document kind.
  readonly acceptedDocumentKinds: ReadonlyArray<StoredDocumentKind> | null;
  // Block creating a link INTO this container, while still allowing a move into
  // it. A move relocates a document's single home; a link adds an additional
  // home. Trash is a move-only destination — deleting a document moves it here —
  // so it opts out of inbound links: you can move something to the Trash, but
  // you cannot link it there. This is the inbound counterpart to
  // `protectContentsFromLinking` (which blocks linking a container's contents
  // OUT). Independent of `acceptedDocumentKinds`, which gates both moves and
  // links by kind.
  readonly protectFromInboundLinks: boolean;
  // Block deleting the builtin self ("You") contact that lives in this
  // container. Only meaningful for the contacts container.
  readonly protectSelfDocumentFromDelete: boolean;
}

interface UserSystemContainerDefinition {
  readonly icon: string | null;
  readonly kind: UserSystemContainerKind;
  readonly name: string;
  // Whether this container is born with the organization: the SDK provisions it
  // server-side in the same transaction as the org (see
  // PROVISIONED_SYSTEM_CONTAINER_SPECS), so the client must NOT also create it
  // device-first. A second local copy would carry the same per-user system slot
  // as the server copy and collide (the slot is unique per organization); the
  // eagerly-provisioned container instead reaches the tree through normal sync.
  readonly provisionedAtOrganizationCreation: boolean;
  readonly rules: UserSystemContainerRules;
  readonly slotDefinition: ContainerSystemSlotDefinition;
  // Whether this system folder stays visible when its parent root is shared
  // with another user. A peer's system slots are HMAC'd from the owner's key,
  // so they never match the viewer's own slots — the explorer falls back to the
  // container name to decide for shared system folders.
  readonly visibleWhenShared: boolean;
}

export interface UserSystemContainer {
  readonly icon: string | null;
  readonly kind: UserSystemContainerKind;
  readonly name: string;
  // Mirrors {@link UserSystemContainerDefinition.provisionedAtOrganizationCreation};
  // the bootstrap uses it to skip device-first creation of eagerly-provisioned
  // containers.
  readonly provisionedAtOrganizationCreation: boolean;
  readonly systemSlot: ContainerSystemSlot;
}

export const USER_SYSTEM_CONTAINER_DEFINITIONS: readonly UserSystemContainerDefinition[] =
  [
    {
      icon: null,
      kind: "contacts",
      name: CONTACTS_CONTAINER_NAME,
      // Contacts stays device-first: created locally at bootstrap and promoted
      // to remote sync after authentication.
      provisionedAtOrganizationCreation: false,
      rules: {
        protectFromMove: true,
        protectFromDelete: true,
        protectFromRename: true,
        protectContentsFromLeaving: true,
        protectContentsFromLinking: false,
        protectSelfDocumentFromDelete: true,
        protectFromUpload: true,
        protectFromChildContainerCreation: true,
        protectFromStructuredDocumentCreation: true,
        acceptedDocumentKinds: ["contact"],
        // Contacts accepts inbound contact links (gated by acceptedDocumentKinds
        // above); only Trash is move-only.
        protectFromInboundLinks: false,
      },
      slotDefinition: CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
      visibleWhenShared: true,
    },
    {
      icon: EXPLORER_TRASH_CONTAINER_ICON,
      kind: "trash",
      name: EXPLORER_TRASH_CONTAINER_NAME,
      // Trash is born with the organization (provisioned server-side in the org
      // creation transaction), so the client never creates it device-first.
      provisionedAtOrganizationCreation: true,
      rules: {
        protectFromMove: true,
        protectFromDelete: true,
        protectFromRename: true,
        // Trash is a destination, not a home: items are expected to leave it
        // (restore) freely, so its contents are not pinned.
        protectContentsFromLeaving: false,
        protectContentsFromLinking: true,
        protectSelfDocumentFromDelete: false,
        protectFromUpload: true,
        protectFromChildContainerCreation: true,
        protectFromStructuredDocumentCreation: true,
        acceptedDocumentKinds: null,
        // Trash is a move-only destination: a document reaches it by being
        // deleted (moved), never by being linked. Blocking inbound links keeps
        // it out of the link-target dropdown while it stays a valid move target.
        protectFromInboundLinks: true,
      },
      slotDefinition: EXPLORER_TRASH_CONTAINER_SYSTEM_SLOT_DEFINITION,
      visibleWhenShared: true,
    },
  ];

// System containers the SDK provisions atomically with every new organization
// (both registration and org-manager creation), so the org is born with them in
// a single server transaction instead of relying on the lazy client-side
// bootstrap. Only the Trash bin is eagerly provisioned today; Contacts stays
// lazy. The lazy `ensureSystemContainer` bootstrap still runs and finds the
// provisioned container by slot, so the two never produce a duplicate. Passed
// into `new Tearleads({ provisionedSystemContainers })`.
export const PROVISIONED_SYSTEM_CONTAINER_SPECS: ReadonlyArray<ProvisionedSystemContainerSpec> =
  USER_SYSTEM_CONTAINER_DEFINITIONS.filter(
    (definition) => definition.provisionedAtOrganizationCreation,
  ).map((definition) => ({
    icon: definition.icon,
    name: definition.name,
    slotDefinition: definition.slotDefinition,
  }));

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
// resolveContainerRules). Only `visibleWhenShared` folders are included.
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

export async function deriveUserSystemContainers(
  signingPrivateKey: Uint8Array,
): Promise<ReadonlyArray<UserSystemContainer>> {
  return Promise.all(
    USER_SYSTEM_CONTAINER_DEFINITIONS.map(async (definition) => ({
      icon: definition.icon,
      kind: definition.kind,
      name: definition.name,
      provisionedAtOrganizationCreation:
        definition.provisionedAtOrganizationCreation,
      systemSlot: await deriveContainerSystemSlot({
        definition: definition.slotDefinition,
        secretKey: signingPrivateKey,
      }),
    })),
  );
}

export function findUserSystemContainer(
  systemContainers: ReadonlyArray<UserSystemContainer>,
  kind: UserSystemContainerKind,
): UserSystemContainer | null {
  return (
    systemContainers.find((systemContainer) => systemContainer.kind === kind) ??
    null
  );
}

// Resolve the rules for a shareable system folder by its name. Used for a peer's
// system folder under a shared root, whose owner-derived slot the viewer cannot
// match. Returns null for non-system names and for folders that are not shared.
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
