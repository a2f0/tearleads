import { expect, test } from "bun:test";
import {
  getContactsContainerId,
  resolveContactsProjectionRootContainerId,
} from "./contactsSystemSlot";

const CONTACTS_SYSTEM_SLOT =
  "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("contacts root falls back to the active root only within the projection org", () => {
  expect(
    resolveContactsProjectionRootContainerId({
      activeOrganizationId: "personal-org",
      activeRootContainerId: "personal-root",
      nodes: [],
      projectionOrganizationId: "personal-org",
    }),
  ).toBe("personal-root");
  expect(
    resolveContactsProjectionRootContainerId({
      activeOrganizationId: "custom-org",
      activeRootContainerId: "custom-root",
      nodes: [],
      projectionOrganizationId: "personal-org",
    }),
  ).toBeNull();
});

test("contacts container lookup uses the active root while org metadata converges", () => {
  const contactsSystemSlot = CONTACTS_SYSTEM_SLOT;

  expect(
    getContactsContainerId(
      [
        {
          id: "personal-contacts",
          organizationId: "personal-org",
          parentId: "personal-root",
          systemSlot: contactsSystemSlot,
        },
        {
          id: "work-contacts",
          organizationId: "local-org",
          parentId: "work-root",
          systemSlot: contactsSystemSlot,
        },
      ],
      contactsSystemSlot,
      "work-org",
      "work-root",
    ),
  ).toBe("work-contacts");
});

test("contacts container lookup still resolves synced containers by organization", () => {
  const contactsSystemSlot = CONTACTS_SYSTEM_SLOT;

  expect(
    getContactsContainerId(
      [
        {
          id: "work-contacts",
          organizationId: "work-org",
          parentId: "work-root",
          systemSlot: contactsSystemSlot,
        },
      ],
      contactsSystemSlot,
      "work-org",
      "missing-root",
    ),
  ).toBe("work-contacts");
});

test("contacts container lookup prefers the active root over an earlier organization match", () => {
  const contactsSystemSlot = CONTACTS_SYSTEM_SLOT;

  expect(
    getContactsContainerId(
      [
        {
          id: "stale-work-contacts",
          organizationId: "work-org",
          parentId: "stale-root",
          systemSlot: contactsSystemSlot,
        },
        {
          id: "active-work-contacts",
          organizationId: "work-org",
          parentId: "active-root",
          systemSlot: contactsSystemSlot,
        },
      ],
      contactsSystemSlot,
      "work-org",
      "active-root",
    ),
  ).toBe("active-work-contacts");
});
