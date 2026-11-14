import { expect, test } from "bun:test";
import {
  deriveStableDocumentId,
  getRosterProfileDocumentLocalId,
} from "@tearleads/client-sdk";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import { getSelectedDocumentMutationState } from "../hooks/selectedDocumentMutationState";
import {
  canMoveDocumentToContainerByRules,
  createExplorerContainerRulesContext,
  isPinnedSelfContact,
} from "./containerRules";
import {
  createReadySelfIdentity,
  createSelfIdentityRules,
  identityDocument,
  selfIdentityNodes,
} from "./selfContactIdentity.testUtils";
import {
  createExplorerTargetLookups,
  getDocumentMoveTargetOptions,
} from "./targetOptions";

const destination = selfIdentityNodes.find(({ id }) => id === "destination");
const editableRuntime = {
  auth: { isAuthenticated: true },
  infra: { dbStatus: "ready" },
  state: { online: true },
} satisfies Parameters<typeof getSelectedDocumentMutationState>[0]["appData"];

test("canonical Me stays pinned before the Contacts slot is available", async () => {
  const identity = await createReadySelfIdentity();
  const rulesContext = createExplorerContainerRulesContext({
    contactsContainerId: null,
    contactsSystemSlot: null,
    currentOrganizationId: "identity-org",
    selfContactIdentity: identity,
    trashSystemSlot: null,
  });
  const document = identityDocument({
    id: identity.identity.localId,
    documentId: identity.identity.documentId,
    documentKind: "contact",
  });
  expect({
    pinned: isPinnedSelfContact(rulesContext, document),
    move: canMoveDocumentToContainerByRules(
      rulesContext,
      selfIdentityNodes.find(({ id }) => id === document.containerId),
      destination,
      document,
    ),
  }).toEqual({ pinned: true, move: false });
});

for (const containerId of ["linked-folder", "trash"]) {
  test(`canonical-D alias is pinned in ${containerId} despite false self fields`, async () => {
    const identity = await createReadySelfIdentity();
    const rulesContext = createSelfIdentityRules(identity);
    const document = {
      ...identityDocument({
        id: "discovered-me-alias",
        documentId: identity.identity.documentId,
        documentKind: "contact",
        containerId,
      }),
      isSelf: false,
      userId: "not-the-current-user",
    };
    // Prove this is a D match, not a fingerprint-local or enumerated-alias match.
    expect(identity.identity.localIds.has(document.id)).toBe(false);
    expect({
      pinned: isPinnedSelfContact(rulesContext, document),
      canMove: canMoveDocumentToContainerByRules(
        rulesContext,
        selfIdentityNodes.find(({ id }) => id === containerId),
        destination,
        document,
      ),
      targets: getDocumentMoveTargetOptions(
        selfIdentityNodes,
        document.id,
        createExplorerTargetLookups(selfIdentityNodes, [document]),
        rulesContext,
        new Map(),
      ),
    }).toEqual({ pinned: true, canMove: false, targets: [] });
  });
}

test("a distinct same-user roster is not pinned by the old projected self id", async () => {
  const identity = await createReadySelfIdentity();
  const roster = {
    ...identityDocument({
      id: "same-user-roster",
      documentId: await deriveStableDocumentId(
        getRosterProfileDocumentLocalId({
          organizationId: "identity-org",
          userId: "current-user",
        }),
      ),
      documentKind: "contact",
    }),
    isSelf: true,
    userId: "current-user",
  };
  const rulesContext = createSelfIdentityRules(identity, roster.id);
  expect(roster.documentId).not.toBe(identity.identity.documentId);
  expect(identity.identity.localIds.has(roster.id)).toBe(false);
  expect({
    pinned: isPinnedSelfContact(rulesContext, roster),
    canMove: canMoveDocumentToContainerByRules(
      rulesContext,
      selfIdentityNodes.find(({ id }) => id === roster.containerId),
      destination,
      roster,
    ),
  }).toEqual({ pinned: false, canMove: true });
});

for (const status of ["pending", "failed", "expired"] as const) {
  test(`${status} self identity refuses an otherwise writable ordinary move`, async () => {
    const identity: SelfContactIdentityView =
      status === "expired"
        ? await createReadySelfIdentity(() => false)
        : status === "failed"
          ? { status: "failed", error: new Error("identity unavailable") }
          : { status: "pending" };
    const document = identityDocument();
    expect(
      canMoveDocumentToContainerByRules(
        createSelfIdentityRules(identity),
        selfIdentityNodes.find(({ id }) => id === document.containerId),
        destination,
        document,
      ),
    ).toBe(false);
  });
}

test("expired identity revokes destructive menu gates even with retained move targets", async () => {
  let current = true;
  const identity = await createReadySelfIdentity(() => current);
  const rulesContext = createSelfIdentityRules(identity);
  const document = identityDocument();
  const moveTargets = getDocumentMoveTargetOptions(
    selfIdentityNodes,
    document.id,
    createExplorerTargetLookups(selfIdentityNodes, [document]),
    rulesContext,
    new Map(),
  );
  expect(moveTargets.map(({ id }) => id)).toContain("destination");
  const input = {
    appData: editableRuntime,
    canResolveTrashContainer: true,
    nodes: selfIdentityNodes,
    rulesContext,
    selectedDocument: document,
    selectedDocumentLinkedContainerIds: ["linked-folder"],
    selectedDocumentLinkTargetOptions: [],
    selectedDocumentMoveTargetOptions: moveTargets,
    trashContainerId: "trash",
    trashSystemSlot: "trash-slot",
  };
  const before = getSelectedDocumentMutationState(input);
  expect(before.canMoveSelectedDocument).toBe(true);
  expect(before.canDeleteSelectedDocument).toBe(true);
  expect(
    getSelectedDocumentMutationState({
      ...input,
      selectedDocument: { ...document, containerId: "trash" },
    }).canPurgeSelectedDocument,
  ).toBe(true);

  current = false;
  const after = getSelectedDocumentMutationState(input);
  expect({
    move: after.canMoveSelectedDocument,
    delete: after.canDeleteSelectedDocument,
    purge: getSelectedDocumentMutationState({
      ...input,
      selectedDocument: { ...document, containerId: "trash" },
    }).canPurgeSelectedDocument,
  }).toEqual({ move: false, delete: false, purge: false });
});
