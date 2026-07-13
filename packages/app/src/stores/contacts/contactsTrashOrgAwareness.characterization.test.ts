import { expect, test } from "bun:test";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { resolveExplorerDeleteTrashTarget } from "../explorer/ExplorerSystemContainers";
import { getContactsTrashContainerId } from "./contactsSystemSlot";

// CHARACTERIZATION TEST (PR 1 of 2) — pins the CURRENT, broken behavior of how the
// Contacts mini-app chooses which Trash a removed contact is moved into. It passes
// on today's code and documents what actually happens; PR 2 will make the Contacts
// resolution org-aware (aligned with Explorer) and replace these expectations.
//
// Unlike Notes, the Contacts store DOES move a removed contact into a Trash
// container (contactStore.ts:315-363 -> runtime.moveDocumentToTrash -> relink;
// proven by contactStore.removeContact.test.ts). The defect is WHICH Trash it
// picks. ContactsProvider resolves a single trash target from the app's CURRENT
// organization, not from the contact document's own container/org:
//
//   ContactsProvider.tsx:118-135
//     trashContainerId = getContactsTrashContainerId(
//       nodes, trashSystemSlot, appData.auth.organizationId, appData.state.containerId)
//
// getContactsTrashContainerId (contactsSystemSlot.ts:58-70 -> getSystemContainerId
// :14-42) has NO parameter for the deleted document's own organization. It is a
// pure function of (currentOrganizationId, currentRootContainerId). So a contact
// that lives under a different org's root is trashed into the CURRENT org's Trash
// (a cross-org re-home) — or resolves to nothing — instead of that org's Trash.
//
// The scenario below mirrors the reproduction: the viewer's app is in `viewer-org`
// while a contact document lives under a foreign shared root owned by `owner-org`.
// A peer org's Trash carries an opaque per-owner system slot the viewer cannot
// derive, so it never matches the viewer's trash slot.

const VIEWER_ORG = "viewer-org";
const VIEWER_ROOT = "viewer-root";
const OWNER_ORG = "owner-org";
const OWNER_ROOT = "owner-root";
const VIEWER_TRASH_SLOT = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

// One shared node snapshot fed to BOTH resolvers so the divergence is apparent:
// the viewer's own org tree plus a foreign shared root owned by `owner-org`, whose
// Contacts holds the removed contact.
const nodes = [
  {
    id: VIEWER_ROOT,
    kind: "container" as const,
    name: "/",
    organizationId: VIEWER_ORG,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "viewer-trash",
    kind: "container" as const,
    name: "Trash",
    organizationId: VIEWER_ORG,
    parentId: VIEWER_ROOT,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: VIEWER_TRASH_SLOT,
  },
  {
    id: OWNER_ROOT,
    kind: "container" as const,
    name: "/",
    organizationId: OWNER_ORG,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "owner-trash",
    kind: "container" as const,
    name: "Trash",
    organizationId: OWNER_ORG,
    parentId: OWNER_ROOT,
    syncState: syncedContainerDocumentObjectSyncState,
    // A peer's Trash carries the owner's opaque per-owner HMAC slot.
    systemSlot: "sys_v1_owner_trash_hmac",
  },
  {
    id: "owner-contacts",
    kind: "container" as const,
    name: "Contacts",
    organizationId: OWNER_ORG,
    parentId: OWNER_ROOT,
    syncState: syncedContainerDocumentObjectSyncState,
    systemSlot: "sys_v1_owner_contacts_hmac",
  },
];

test("characterization: Contacts resolves the Trash target from the CURRENT org, ignoring the contact's own org", () => {
  // The contact document lives in `owner-contacts` (owner-org), but ContactsProvider
  // only ever feeds getContactsTrashContainerId the CURRENT (viewer) org/root. The
  // result is the viewer's Trash — a cross-org re-home of the owner-org contact.
  expect(
    getContactsTrashContainerId(
      nodes,
      VIEWER_TRASH_SLOT,
      VIEWER_ORG,
      VIEWER_ROOT,
    ),
  ).toBe("viewer-trash");

  // There is no channel to reach the contact's own-org Trash: the owner org's Trash
  // uses an opaque per-owner slot the viewer's trash slot never matches, so even
  // pointing the resolver at the owner org yields nothing.
  expect(
    getContactsTrashContainerId(
      nodes,
      VIEWER_TRASH_SLOT,
      OWNER_ORG,
      OWNER_ROOT,
    ),
  ).toBeNull();
});

test("reference: Explorer resolves the SAME contact's Trash from the document's own org (the behavior Contacts lacks)", () => {
  // Explorer derives the target from the DOCUMENT's own container. For a document
  // under a foreign shared root it targets THAT org's Trash (matched by name) and
  // refuses to fall back to the viewer's Trash. This is the org-aware resolution
  // that Contacts (and Notes) should adopt in PR 2.
  expect(
    resolveExplorerDeleteTrashTarget({
      containerId: "owner-contacts",
      currentOrganizationId: VIEWER_ORG,
      nodes,
      trashSystemSlot: VIEWER_TRASH_SLOT,
    }),
  ).toEqual({ canFallBackToOwnTrash: false, trashContainerId: "owner-trash" });
});
