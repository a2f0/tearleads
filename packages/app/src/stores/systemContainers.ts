import type {
  ContainerNode,
  ContainerSystemSlotDefinition,
  ProvisionedSystemContainerSpec,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  deriveContainerSystemSlot,
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
  deriveRegistrationOrganizationId,
  ORGANIZATION_METADATA_CONTAINER_NAME,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
} from "@tearleads/client-sdk";
import {
  type ContainerSystemSlot,
  deriveOrganizationTrashSystemSlot,
  ORGANIZATION_TRASH_SLOT_NAMESPACE,
} from "@tearleads/validators/containerSystemSlot";

export const CONTACTS_CONTAINER_NAME = "Contacts";
// Icon slug for the Contacts system folder, resolved to a glyph by
// getExplorerContainerIcon. Matches the address-book glyph the Contacts mini app
// uses (see MINI_APP_ICONS) so the folder and the app read as the same thing.
// Every bootstrap caller uses the same initial icon, including racing creators.
export const CONTACTS_CONTAINER_ICON = "contacts";
const CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION: ContainerSystemSlotDefinition =
  {
    namespace: "tearleads.contacts",
    projectorId: "contact",
    slotId: "contacts",
    version: 1,
  };

export const EXPLORER_TRASH_CONTAINER_NAME = "Trash";
export const EXPLORER_TRASH_CONTAINER_ICON = "trash";

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
  // Contacts raises this and still takes new contacts through its own action,
  // and through History's "Save as copy" of a contact version
  // (canSaveDocumentCopyByRules).
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
  // The regular bootstrap skips containers included in the signed org creation.
  readonly provisionedAtOrganizationCreation: boolean;
  readonly rules: UserSystemContainerRules;
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
      icon: CONTACTS_CONTAINER_ICON,
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
    },
  ];

// Used for personal registration and additional organization creation.
export const PROVISIONED_SYSTEM_CONTAINER_SPECS: ReadonlyArray<ProvisionedSystemContainerSpec> =
  [
    {
      icon: EXPLORER_TRASH_CONTAINER_ICON,
      name: EXPLORER_TRASH_CONTAINER_NAME,
      slotNamespace: ORGANIZATION_TRASH_SLOT_NAMESPACE,
    },
  ];

// Explorer reveals these SDK-managed folders through the built-in containers flag.
export type BuiltInSystemContainerKind =
  | "organizationMetadata"
  | "organizationRosterProfiles";

// Built-in containers are app-owned endpoints: the org workflows write roster
// profiles and organization metadata into them, and nothing else belongs there.
// Blocking inbound links is the only rule they carry — revealing them with the
// feature flag must not turn them into "Link Document" destinations, while
// everything else about them stays inspectable, which is the point of the flag.
const BUILT_IN_SYSTEM_CONTAINER_RULES: UserSystemContainerRules = {
  protectFromMove: false,
  protectFromDelete: false,
  protectFromRename: false,
  protectContentsFromLeaving: false,
  protectContentsFromLinking: false,
  protectSelfDocumentFromDelete: false,
  protectFromUpload: false,
  protectFromChildContainerCreation: false,
  protectFromStructuredDocumentCreation: false,
  acceptedDocumentKinds: null,
  protectFromInboundLinks: true,
};

interface BuiltInSystemContainerDefinition {
  readonly deriveSystemSlot: (input: {
    readonly organizationId: string;
  }) => Promise<ContainerSystemSlot>;
  readonly kind: BuiltInSystemContainerKind;
  readonly name: string;
  readonly rules: UserSystemContainerRules;
}

// Built as a function, not a module-level constant: these are the only client
// SDK values this module reads, and in the bundled app the SDK barrel is still
// uninitialized when this module evaluates (its exports read back as null), so
// reading them at module scope crashes the app on load. Every other client-sdk
// reference here is likewise reached from inside a function body.
function getBuiltInSystemContainerDefinitions(): readonly BuiltInSystemContainerDefinition[] {
  return [
    {
      deriveSystemSlot: deriveOrganizationRosterProfileContainerSystemSlot,
      kind: "organizationRosterProfiles",
      name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
      rules: BUILT_IN_SYSTEM_CONTAINER_RULES,
    },
    {
      deriveSystemSlot: deriveOrganizationMetadataContainerSystemSlot,
      kind: "organizationMetadata",
      name: ORGANIZATION_METADATA_CONTAINER_NAME,
      rules: BUILT_IN_SYSTEM_CONTAINER_RULES,
    },
  ];
}

// A built-in system container resolved for one organization. Mirrors
// UserSystemContainer, plus the rules themselves: a built-in container has no
// per-user slot to look its rules up by kind with, so the resolved slot carries
// them (see createExplorerContainerRulesContext).
export interface BuiltInSystemContainer {
  readonly kind: BuiltInSystemContainerKind;
  readonly name: string;
  readonly rules: UserSystemContainerRules;
  readonly systemSlot: ContainerSystemSlot;
}

export function deriveBuiltInSystemContainers(input: {
  organizationId: string;
}): Promise<ReadonlyArray<BuiltInSystemContainer>> {
  return Promise.all(
    getBuiltInSystemContainerDefinitions().map(async (definition) => ({
      kind: definition.kind,
      name: definition.name,
      rules: definition.rules,
      systemSlot: await definition.deriveSystemSlot({
        organizationId: input.organizationId,
      }),
    })),
  );
}

export function getUserSystemContainerRulesByKind(
  kind: UserSystemContainerKind,
): UserSystemContainerRules | null {
  return (
    USER_SYSTEM_CONTAINER_DEFINITIONS.find(
      (definition) => definition.kind === kind,
    )?.rules ?? null
  );
}

export interface SystemContainerScope {
  signingPrivateKey: Uint8Array;
  organizationId: string | null;
  rootContainerId: string | null;
}

export async function deriveUserSystemContainers({
  signingPrivateKey,
  organizationId,
  rootContainerId,
}: SystemContainerScope): Promise<ReadonlyArray<UserSystemContainer>> {
  const trashOrganizationId =
    organizationId ??
    (rootContainerId &&
      (await deriveRegistrationOrganizationId(rootContainerId)));
  const contactsSlot = await deriveContainerSystemSlot({
    definition: CONTACTS_CONTAINER_SYSTEM_SLOT_DEFINITION,
    secretKey: signingPrivateKey,
  });
  const trashSlot = trashOrganizationId
    ? deriveOrganizationTrashSystemSlot(trashOrganizationId)
    : null;
  return USER_SYSTEM_CONTAINER_DEFINITIONS.flatMap(
    ({ icon, kind, name, provisionedAtOrganizationCreation }) => {
      const systemSlot = kind === "contacts" ? contactsSlot : trashSlot;
      return systemSlot
        ? [{ icon, kind, name, provisionedAtOrganizationCreation, systemSlot }]
        : [];
    },
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

// Device-first nodes have no organization ID until registration. Their current
// slot was calculated from the organization ID planned for their local root.
export function isTrashSystemContainerNode(
  node: Pick<ContainerNode, "organizationId" | "systemSlot">,
  input: {
    currentOrganizationId: string | null | undefined;
    trashSystemSlot: ContainerSystemSlot | null;
  },
): boolean {
  if (!node.systemSlot) return false;
  return (
    node.systemSlot ===
    (node.organizationId &&
    (!input.trashSystemSlot ||
      node.organizationId !== input.currentOrganizationId)
      ? deriveOrganizationTrashSystemSlot(node.organizationId)
      : input.trashSystemSlot)
  );
}

// Whether a container node is the viewer's OWN Contacts system folder, matched by
// its derived system slot rather than by a resolved container id. The slot is
// derived from the signing key (see deriveUserSystemContainers), so this holds
// offline and before the first sync — unlike the org-scoped Contacts container id
// resolution, which returns null until an organization id is assigned.
export function isContactsSystemContainerNode(
  node: Pick<ContainerNode, "systemSlot"> | null | undefined,
  contactsSystemSlot: ContainerSystemSlot | null,
): boolean {
  return (
    node != null &&
    node.systemSlot != null &&
    contactsSystemSlot != null &&
    node.systemSlot === contactsSystemSlot
  );
}
