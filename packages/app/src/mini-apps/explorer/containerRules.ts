import {
  type ContainerNode,
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { isSelfContactLocalId } from "../../stores/contacts/selfContact";
import {
  getSharedSystemContainerRulesByName,
  getUserSystemContainerRulesByKind,
  isUnderForeignSharedRoot,
  type UserSystemContainerRules,
} from "../../stores/systemContainers";

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
  rulesBySystemSlot: ReadonlyMap<ContainerSystemSlot, UserSystemContainerRules>;
}

interface ExplorerContainerRulesInput {
  contactsContainerId: string | null;
  contactsSystemSlot: ContainerSystemSlot | null;
  currentOrganizationId: string | null;
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

  return {
    contactsContainerId: input.contactsContainerId,
    contactsSystemSlot: input.contactsSystemSlot,
    currentOrganizationId: input.currentOrganizationId,
    rulesBySystemSlot,
  };
}

// Fields a container must carry for its rules to be resolvable. `name` and
// `organizationId` are only consulted for the shared-root fallback below; a
// same-org container is resolved purely by slot.
type ContainerRulesNode = Pick<
  ContainerNode,
  "systemSlot" | "name" | "organizationId"
>;

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

export function canMoveContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return resolveContainerRules(context, container)?.protectFromMove !== true;
}

export function canDeleteContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return resolveContainerRules(context, container)?.protectFromDelete !== true;
}

export function canRenameContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return resolveContainerRules(context, container)?.protectFromRename !== true;
}

// Files may be uploaded into a container unless it is a protected system folder
// (e.g. the Trash, which is only ever populated by deleting documents).
export function canUploadToContainerByRules(
  context: ExplorerContainerRulesContext,
  container: ContainerRulesNode | undefined,
): boolean {
  return resolveContainerRules(context, container)?.protectFromUpload !== true;
}

// Resolve a container by id from the explorer's node list and report whether it
// accepts uploads. Used to gate every import path (context menu and
// drag-and-drop) at a single chokepoint; an unknown id is treated as uploadable
// since it carries no system slot.
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

export function isSelfContactDocument(
  document: Pick<DocumentSummary, "id"> | undefined,
): boolean {
  return document ? isSelfContactLocalId(document.id) : false;
}

// A document may move out of its current container unless that container pins
// its contents (e.g. contacts must stay in the Contacts container).
export function canMoveDocumentOutByRules(
  context: ExplorerContainerRulesContext,
  currentContainer: ContainerRulesNode | undefined,
): boolean {
  return (
    resolveContainerRules(context, currentContainer)
      ?.protectContentsFromLeaving !== true
  );
}

// A document may move or link into a destination container unless that
// container restricts inbound documents by kind (e.g. Contacts accepts contacts
// only). An unknown destination carries no system slot, so it remains
// permissive like the other rule helpers.
export function canAddDocumentToContainerByRules(
  context: ExplorerContainerRulesContext,
  destinationContainer: ContainerRulesNode | undefined,
  document: Pick<DocumentSummary, "documentKind"> | undefined,
): boolean {
  const acceptedDocumentKinds =
    resolveContainerRules(context, destinationContainer)
      ?.acceptedDocumentKinds ?? null;
  if (acceptedDocumentKinds === null) {
    return true;
  }

  const documentKind = document?.documentKind ?? DEFAULT_DOCUMENT_KIND;
  return acceptedDocumentKinds.includes(documentKind);
}

// The builtin self ("You") contact is protected from deletion when the Contacts
// container's rules say so.
export function canDeleteDocumentByRules(
  context: ExplorerContainerRulesContext,
  document: Pick<DocumentSummary, "id" | "containerId"> | undefined,
): boolean {
  if (!document) {
    return true;
  }

  if (
    isSelfContactDocument(document) &&
    context.contactsContainerId !== null &&
    document.containerId === context.contactsContainerId
  ) {
    const contactsRules = context.contactsSystemSlot
      ? context.rulesBySystemSlot.get(context.contactsSystemSlot)
      : null;
    return contactsRules?.protectSelfDocumentFromDelete !== true;
  }

  return true;
}
