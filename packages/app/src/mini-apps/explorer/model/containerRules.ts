import {
  type ContainerNode,
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { CurrentSelfContactIdentity } from "../../../stores/contacts/currentSelfContactIdentity";
import {
  matchesSelfContactIdentity,
  type SelfContactIdentityView,
} from "../../../stores/contacts/currentSelfContactIdentityState";
import {
  type BuiltInSystemContainer,
  getSharedSystemContainerRulesByName,
  getUserSystemContainerRulesByKind,
  isUnderForeignSharedRoot,
  type UserSystemContainerRules,
} from "../../../stores/systemContainers";

// The configured rules keyed by the system slot they apply to. A container with
// no system slot (a plain user container) has no rules and is fully mutable.
// `currentOrganizationId` is the viewer's own organization; a container from a
// different org is a peer's shared folder whose owner-derived slot the viewer
// cannot match, so its rules are resolved by name instead (see
// resolveContainerRules).
export interface ExplorerContainerRulesContext {
  contactsContainerId: string | null;
  contactsSystemSlot: ContainerSystemSlot | null;
  currentOrganizationId: string | null;
  selfContactIdentity: SelfContactIdentityView;
  rulesBySystemSlot: ReadonlyMap<ContainerSystemSlot, UserSystemContainerRules>;
}

interface ExplorerContainerRulesInput {
  // The org-scoped system containers the feature flag can reveal (Roster
  // Profiles, Organization Metadata). Empty while they stay hidden, in which
  // case their slots carry no rules — nothing can reach a container the tree
  // does not show.
  builtInSystemContainers?: ReadonlyArray<BuiltInSystemContainer> | undefined;
  contactsContainerId: string | null;
  contactsSystemSlot: ContainerSystemSlot | null;
  currentOrganizationId: string | null;
  selfContactIdentity: SelfContactIdentityView;
  trashSystemSlot: ContainerSystemSlot | null;
}

// Build the rules context from the explorer's already-derived system slots. The
// rule values themselves come from the system container configuration, so a
// flag flipped off there disables the corresponding rule everywhere.
export function createExplorerContainerRulesContext(
  input: ExplorerContainerRulesInput,
): ExplorerContainerRulesContext {
  const rulesBySystemSlot = new Map<
    ContainerSystemSlot,
    UserSystemContainerRules
  >();
  const contactsRules = getUserSystemContainerRulesByKind("contacts");
  if (input.contactsSystemSlot && contactsRules) {
    rulesBySystemSlot.set(input.contactsSystemSlot, contactsRules);
  }
  const trashRules = getUserSystemContainerRulesByKind("trash");
  if (input.trashSystemSlot && trashRules) {
    rulesBySystemSlot.set(input.trashSystemSlot, trashRules);
  }
  // Built-in containers carry their own rules rather than a kind-keyed lookup,
  // because their slots are derived per organization instead of per user.
  for (const builtInSystemContainer of input.builtInSystemContainers ?? []) {
    rulesBySystemSlot.set(
      builtInSystemContainer.systemSlot,
      builtInSystemContainer.rules,
    );
  }

  return {
    contactsContainerId: input.contactsContainerId,
    contactsSystemSlot: input.contactsSystemSlot,
    currentOrganizationId: input.currentOrganizationId,
    selfContactIdentity: input.selfContactIdentity,
    rulesBySystemSlot,
  };
}

// Fields a container must carry for its rules to be resolvable. `name` and
// `organizationId` are only consulted for the shared-root fallback below; a
// same-org container is resolved purely by slot.
type ContainerRulesNode = Pick<
  ContainerNode,
  "effectiveAccessLevel" | "systemSlot" | "name" | "organizationId"
>;

export function canWriteContainerNode(
  container: Pick<ContainerNode, "effectiveAccessLevel"> | null | undefined,
): boolean {
  return container != null && container.effectiveAccessLevel !== "read";
}

// Whether the viewer administers the container (the strongest access level).
// Unlike canWriteContainerNode (write-or-admin), this is strictly admin, matching
// the crypto-layer gate on grant/revoke and used to gate admin-only settings such
// as the container icon picker.
export function canAdminContainerNode(
  container: Pick<ContainerNode, "effectiveAccessLevel"> | null | undefined,
): boolean {
  return container != null && container.effectiveAccessLevel === "admin";
}

export function canWriteDocumentSummary(
  document: Pick<DocumentSummary, "effectiveAccessLevel"> | null | undefined,
): boolean {
  return document != null && document.effectiveAccessLevel !== "read";
}

function resolveContainerRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): UserSystemContainerRules | null {
  if (!container) {
    return null;
  }

  const systemSlot = container.systemSlot ?? null;
  if (systemSlot) {
    const rulesBySlot = context.rulesBySystemSlot.get(systemSlot);
    if (rulesBySlot) {
      return rulesBySlot;
    }
  }

  // A peer's system folder under a shared root carries the owner's opaque HMAC
  // slot, which never matches the viewer's own slots, so the slot lookup above
  // misses. Fall back to resolving the rules by name — but only for a genuine
  // foreign-org shared folder, so a same-org sibling cannot spoof a system name
  // to fabricate rules. Own-org containers therefore stay strictly slot-keyed.
  if (
    isUnderForeignSharedRoot({
      currentOrganizationId: context.currentOrganizationId,
      organizationId: container.organizationId,
    })
  ) {
    return getSharedSystemContainerRulesByName(container.name);
  }

  return null;
}

export function hasContainerRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return resolveContainerRules(context, container) !== null;
}

// The shared shape of every per-operation container gate: the container must be
// writable and its resolved rules (if any) must not raise the given protection
// flag.
function allowedByContainerRule(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
  flag: keyof UserSystemContainerRules,
): boolean {
  return (
    canWriteContainerNode(container) &&
    resolveContainerRules(context, container)?.[flag] !== true
  );
}

export function canMoveContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return allowedByContainerRule(context, container, "protectFromMove");
}

export function canRenameContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return allowedByContainerRule(context, container, "protectFromRename");
}

// Files may be uploaded into a container unless it is a protected system folder
// (e.g. the Trash, which is only ever populated by deleting documents).
export function canUploadToContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return allowedByContainerRule(context, container, "protectFromUpload");
}

// Child containers are a structural mutation of the parent container. System
// folders that are app-managed endpoints (Contacts, Trash) opt out so their
// subtree stays reserved for app-owned content.
export function canCreateChildContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return allowedByContainerRule(
    context,
    container,
    "protectFromChildContainerCreation",
  );
}

// Structured-document creation is separate from uploads and moves: it creates a
// new local document directly in the target container, so system folders need
// their own gate instead of relying on accepted inbound document kinds.
export function canCreateStructuredDocumentInContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return allowedByContainerRule(
    context,
    container,
    "protectFromStructuredDocumentCreation",
  );
}

// Resolve a container by id from the explorer's node list and report whether it
// accepts uploads. Used to gate every import path (context menu and
// drag-and-drop) at a single chokepoint; an unknown id fails closed because its
// effective write access cannot be proven.
export function canUploadToContainerIdByRules(
  context: ExplorerContainerRulesContext,
  nodes: ReadonlyArray<Pick<ContainerNode, "id"> & ContainerRulesNode>,
  containerId: string,
): boolean {
  return canUploadToContainerByRules(
    context,
    nodes.find((node) => node.id === containerId),
  );
}

// Personal Me follows persisted document identity and all of its known local
// aliases, not mutable contact fields or a single projected Contacts row.
export function isSelfContactDocument(
  document: Pick<DocumentSummary, "id" | "documentId"> | undefined,
  identity: CurrentSelfContactIdentity | null | undefined,
): boolean {
  return Boolean(
    document && identity && matchesSelfContactIdentity(identity, document),
  );
}

export function canMutateDocumentByIdentity(
  context: ExplorerContainerRulesContext,
  document: Pick<DocumentSummary, "id" | "documentId"> | undefined,
): boolean {
  const identity = context.selfContactIdentity;
  return (
    document !== undefined &&
    identity.status === "ready" &&
    identity.isCurrent() &&
    !isPinnedSelfContact(context, document)
  );
}

// A document may move out of its current container unless that container pins
// its contents (e.g. contacts must stay in the Contacts container).
export function canMoveDocumentOutByRules(
  context: ExplorerContainerRulesContext,
  currentContainer: ContainerRulesNode | undefined,
): boolean {
  return allowedByContainerRule(
    context,
    currentContainer,
    "protectContentsFromLeaving",
  );
}

function isTrashContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return (
    resolveContainerRules(context, container) ===
    getUserSystemContainerRulesByKind("trash")
  );
}

// A document may move between two containers when the destination accepts the
// document kind and the source allows ordinary moves. Contacts pins its contents
// as a home container, but deletion is implemented as a move to Trash, so Trash
// is the one legal destination for protected contents.
export function canMoveDocumentToContainerByRules(
  context: ExplorerContainerRulesContext,
  currentContainer: ContainerRulesNode | null | undefined,
  destinationContainer: ContainerRulesNode | undefined,
  document:
    | Pick<DocumentSummary, "documentKind" | "documentId" | "id">
    | undefined,
): boolean {
  if (
    !canMutateDocumentByIdentity(context, document) ||
    !canAddDocumentToContainerByRules(context, destinationContainer, document)
  ) {
    return false;
  }

  if (currentContainer === null) {
    return true;
  }

  if (!canWriteContainerNode(currentContainer)) {
    return false;
  }

  return (
    canMoveDocumentOutByRules(context, currentContainer) ||
    isTrashContainerByRules(context, destinationContainer)
  );
}

export function canLinkDocumentOutByRules(
  context: ExplorerContainerRulesContext,
  currentContainer: ContainerRulesNode | undefined,
): boolean {
  return allowedByContainerRule(
    context,
    currentContainer,
    "protectContentsFromLinking",
  );
}

// A document may move or link into a destination container unless that
// container restricts inbound documents by kind (e.g. Contacts accepts contacts
// only). An unknown destination fails closed because its effective write access
// cannot be proven.
export function canAddDocumentToContainerByRules(
  context: ExplorerContainerRulesContext,
  destinationContainer: ContainerRulesNode | undefined,
  document: Pick<DocumentSummary, "documentKind"> | undefined,
): boolean {
  const acceptedDocumentKinds =
    resolveContainerRules(context, destinationContainer)
      ?.acceptedDocumentKinds ?? null;
  if (!canWriteContainerNode(destinationContainer)) {
    return false;
  }

  if (acceptedDocumentKinds === null) {
    return true;
  }

  const documentKind = document?.documentKind ?? DEFAULT_DOCUMENT_KIND;
  return acceptedDocumentKinds.includes(documentKind);
}

// A document may LINK into a destination only if it could also move there AND the
// destination accepts inbound links. This is stricter than
// canAddDocumentToContainerByRules (which the move path uses): a move-only system
// folder such as Trash accepts moves — deleting a document moves it there — but
// rejects links, so it must be filtered out of the link-target dropdown. Keeping
// the kind/write check in canAddDocumentToContainerByRules means link and move
// stay in sync on everything except this inbound-link gate.
export function canLinkDocumentIntoContainerByRules(
  context: ExplorerContainerRulesContext,
  destinationContainer: ContainerRulesNode | undefined,
  document: Pick<DocumentSummary, "documentKind"> | undefined,
): boolean {
  if (
    !canAddDocumentToContainerByRules(context, destinationContainer, document)
  ) {
    return false;
  }

  return (
    resolveContainerRules(context, destinationContainer)
      ?.protectFromInboundLinks !== true
  );
}

// The viewer's own self ("You") contact is pinned when the Contacts container's
// rules say so: it may be linked into and unlinked from other containers, but
// never deleted, moved, or purged. The guard follows the contact by identity,
// not by which container it happens to be viewed from — a document surfaces
// under each container it is linked into carrying that container's id, so a
// container-scoped check would miss the linked view. Delete, move, and purge
// gates all consult this one predicate because they are equivalent destructive
// routes: "delete" is a move to Trash, and a move into Trash re-enables purge,
// so guarding only delete would leave the self contact destroyable via Move.
export function isPinnedSelfContact(
  context: ExplorerContainerRulesContext,
  document: Pick<DocumentSummary, "id" | "documentId"> | undefined,
): boolean {
  const identity = context.selfContactIdentity;
  if (
    identity.status !== "ready" ||
    !isSelfContactDocument(document, identity.identity)
  ) {
    return false;
  }
  // Identity can resolve before the Contacts container/slot is discovered.
  // Its configured protection must not disappear during that loading window.
  const contactsRules = context.contactsSystemSlot
    ? context.rulesBySystemSlot.get(context.contactsSystemSlot)
    : getUserSystemContainerRulesByKind("contacts");
  return contactsRules?.protectSelfDocumentFromDelete === true;
}
