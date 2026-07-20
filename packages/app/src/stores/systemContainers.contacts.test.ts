import { expect, test } from "bun:test";
import {
  CONTACTS_CONTAINER_NAME,
  isContactsSystemContainerNode,
} from "./systemContainers";

const OWN_CONTACTS_SLOT = "contacts-slot-self";
const PEER_CONTACTS_SLOT = "contacts-slot-peer";

interface TestNode {
  name: string;
  organizationId: string;
  systemSlot: string | null;
}

function node(partial: Partial<TestNode> = {}): TestNode {
  return {
    name: CONTACTS_CONTAINER_NAME,
    organizationId: "",
    systemSlot: null,
    ...partial,
  };
}

test("the viewer's own Contacts container matches by slot", () => {
  const contacts = node({ systemSlot: OWN_CONTACTS_SLOT });

  expect(isContactsSystemContainerNode(contacts, OWN_CONTACTS_SLOT)).toBe(true);
});

test("matches offline before an organization id is assigned (empty org)", () => {
  // An account created offline and not yet synced carries no organization id on
  // its local containers, which is exactly the state that nulls the org-scoped
  // Contacts container id resolution. Slot matching must still hold.
  const contacts = node({ organizationId: "", systemSlot: OWN_CONTACTS_SLOT });

  expect(isContactsSystemContainerNode(contacts, OWN_CONTACTS_SLOT)).toBe(true);
});

test("a peer's shared Contacts folder does not match (owner-derived slot)", () => {
  const peerContacts = node({
    organizationId: "org-peer",
    systemSlot: PEER_CONTACTS_SLOT,
  });

  expect(isContactsSystemContainerNode(peerContacts, OWN_CONTACTS_SLOT)).toBe(
    false,
  );
});

test("a non-system folder does not match", () => {
  const folder = node({ name: "Documents", systemSlot: null });

  expect(isContactsSystemContainerNode(folder, OWN_CONTACTS_SLOT)).toBe(false);
});

test("a null or missing node, or a null slot, does not match", () => {
  expect(isContactsSystemContainerNode(null, OWN_CONTACTS_SLOT)).toBe(false);
  expect(isContactsSystemContainerNode(undefined, OWN_CONTACTS_SLOT)).toBe(
    false,
  );
  expect(
    isContactsSystemContainerNode(
      node({ systemSlot: OWN_CONTACTS_SLOT }),
      null,
    ),
  ).toBe(false);
});
