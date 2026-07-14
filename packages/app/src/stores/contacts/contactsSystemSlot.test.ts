import { expect, test } from "bun:test";
import {
  getContactsContainerId,
  resolveContactsProjectionOrganizationId,
} from "./contactsSystemSlot";

const CONTACTS_SYSTEM_SLOT =
  "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("contacts projection uses the authoritative default organization", () => {
  expect(
    resolveContactsProjectionOrganizationId({
      contactsSystemSlot: CONTACTS_SYSTEM_SLOT,
      defaultOrganizationId: "personal-org",
      legacyPrimaryOrganizationId: "custom-org",
      nodes: [
        {
          id: "stale-contacts",
          organizationId: "stale-org",
          parentId: "stale-root",
          systemSlot: CONTACTS_SYSTEM_SLOT,
        },
      ],
    }),
  ).toBe("personal-org");
});

test("legacy contacts projection follows an existing personal Contacts slot", () => {
  expect(
    resolveContactsProjectionOrganizationId({
      contactsSystemSlot: CONTACTS_SYSTEM_SLOT,
      defaultOrganizationId: null,
      legacyPrimaryOrganizationId: "custom-org",
      nodes: [
        {
          id: "personal-contacts",
          organizationId: "personal-org",
          parentId: "personal-root",
          systemSlot: CONTACTS_SYSTEM_SLOT,
        },
      ],
    }),
  ).toBe("personal-org");
});

test("legacy contacts projection falls back when Contacts is not projected", () => {
  expect(
    resolveContactsProjectionOrganizationId({
      contactsSystemSlot: CONTACTS_SYSTEM_SLOT,
      defaultOrganizationId: null,
      legacyPrimaryOrganizationId: "custom-org",
      nodes: [],
    }),
  ).toBe("custom-org");
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
