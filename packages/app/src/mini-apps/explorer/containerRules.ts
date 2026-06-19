import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  getUserSystemContainerRulesByKind,
  type UserSystemContainerRules,
} from "../../stores/systemContainers";

// Documents created for the builtin "You" contact use this deterministic local
// id prefix (see stores/contacts/selfContact.ts). We match on the prefix here
// so the explorer can recognise the self contact from a DocumentSummary alone,
// without loading its structured fields.
const SELF_CONTACT_LOCAL_ID_PREFIX = "self_contact_v1_";

// The configured rules keyed by the system slot they apply to. A container with
// no system slot (a plain user container) has no rules and is fully mutable.
export interface ExplorerContainerRulesContext {
  contactsContainerId: string | null;
  contactsSystemSlot: ContainerSystemSlot | null;
  rulesBySystemSlot: ReadonlyMap<ContainerSystemSlot, UserSystemContainerRules>;
}

interface ExplorerContainerRulesInput {
  contactsContainerId: string | null;
  contactsSystemSlot: ContainerSystemSlot | null;
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
    rulesBySystemSlot,
  };
}

function resolveContainerRules(
  context: ExplorerContainerRulesContext,
  container: Pick<ContainerNode, "systemSlot"> | undefined,
): UserSystemContainerRules | null {
  const systemSlot = container?.systemSlot ?? null;
  if (!systemSlot) {
    return null;
  }

  return context.rulesBySystemSlot.get(systemSlot) ?? null;
}

export function canMoveContainerByRules(
  context: ExplorerContainerRulesContext,
  container: Pick<ContainerNode, "systemSlot"> | undefined,
): boolean {
  return resolveContainerRules(context, container)?.protectFromMove !== true;
}

export function canDeleteContainerByRules(
  context: ExplorerContainerRulesContext,
  container: Pick<ContainerNode, "systemSlot"> | undefined,
): boolean {
  return resolveContainerRules(context, container)?.protectFromDelete !== true;
}

export function canRenameContainerByRules(
  context: ExplorerContainerRulesContext,
  container: Pick<ContainerNode, "systemSlot"> | undefined,
): boolean {
  return resolveContainerRules(context, container)?.protectFromRename !== true;
}

// Files may be uploaded into a container unless it is a protected system folder
// (e.g. the Trash, which is only ever populated by deleting documents).
export function canUploadToContainerByRules(
  context: ExplorerContainerRulesContext,
  container: Pick<ContainerNode, "systemSlot"> | undefined,
): boolean {
  return resolveContainerRules(context, container)?.protectFromUpload !== true;
}

// Resolve a container by id from the explorer's node list and report whether it
// accepts uploads. Used to gate every import path (context menu and
// drag-and-drop) at a single chokepoint; an unknown id is treated as uploadable
// since it carries no system slot.
export function canUploadToContainerIdByRules(
  context: ExplorerContainerRulesContext,
  nodes: ReadonlyArray<Pick<ContainerNode, "id" | "systemSlot">>,
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
  return document?.id.startsWith(SELF_CONTACT_LOCAL_ID_PREFIX) ?? false;
}

// A document may move out of its current container unless that container pins
// its contents (e.g. contacts must stay in the Contacts container).
export function canMoveDocumentOutByRules(
  context: ExplorerContainerRulesContext,
  currentContainer: Pick<ContainerNode, "systemSlot"> | undefined,
): boolean {
  return (
    resolveContainerRules(context, currentContainer)
      ?.protectContentsFromLeaving !== true
  );
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
