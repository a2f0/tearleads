import { expect, test } from "bun:test";
import {
  getContactsContainerId,
  getContactsTrashContainerId,
} from "./contactsSystemSlot";

test("contacts container lookup uses the active root while org metadata converges", () => {
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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
  const contactsSystemSlot =
    "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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

test("contacts trash lookup uses the active custom organization root", () => {
  const trashSystemSlot = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

  expect(
    getContactsTrashContainerId(
      [
        {
          id: "personal-trash",
          organizationId: "personal-org",
          parentId: "personal-root",
          systemSlot: trashSystemSlot,
        },
        {
          id: "custom-trash",
          organizationId: "custom-org",
          parentId: "custom-root",
          systemSlot: trashSystemSlot,
        },
      ],
      trashSystemSlot,
      "custom-org",
      "custom-root",
    ),
  ).toBe("custom-trash");
});

test("contacts trash lookup falls back by organization while root metadata converges", () => {
  const trashSystemSlot = "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";

  expect(
    getContactsTrashContainerId(
      [
        {
          id: "personal-trash",
          organizationId: "personal-org",
          parentId: "personal-root",
          systemSlot: trashSystemSlot,
        },
        {
          id: "custom-trash",
          organizationId: "custom-org",
          parentId: "stale-custom-root",
          systemSlot: trashSystemSlot,
        },
      ],
      trashSystemSlot,
      "custom-org",
      "active-custom-root",
    ),
  ).toBe("custom-trash");
});
