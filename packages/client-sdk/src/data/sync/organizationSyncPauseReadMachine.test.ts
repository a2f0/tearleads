import { expect, test } from "bun:test";
import {
  type OrganizationSyncPauseRead,
  organizationSyncPausesUnreadable,
  transitionOrganizationSyncPauseRead,
  UNREAD_ORGANIZATION_SYNC_PAUSES,
} from "./organizationSyncPauseReadMachine";

const firstRead = Promise.resolve();
const secondRead = Promise.resolve();

function after(
  ...events: Parameters<typeof transitionOrganizationSyncPauseRead>[1][]
): OrganizationSyncPauseRead {
  return events.reduce(
    transitionOrganizationSyncPauseRead,
    UNREAD_ORGANIZATION_SYNC_PAUSES,
  );
}

test("a first read is shared while in flight and once settled", () => {
  const reading = after({ read: firstRead, type: "start" });
  expect(reading).toEqual({
    afterFailure: false,
    read: firstRead,
    status: "reading",
  });
  expect(
    transitionOrganizationSyncPauseRead(reading, {
      read: secondRead,
      type: "start",
    }),
  ).toBe(reading);

  const read = after({ read: firstRead, type: "start" }, { type: "succeed" });
  expect(read).toEqual({ read: firstRead, status: "read" });
  expect(
    transitionOrganizationSyncPauseRead(read, {
      read: secondRead,
      type: "start",
    }),
  ).toBe(read);
  expect(organizationSyncPausesUnreadable(read)).toBe(false);
});

test("a failed read stays unreadable through its retry until one succeeds", () => {
  const failed = after({ read: firstRead, type: "start" }, { type: "fail" });
  expect(failed).toEqual({ status: "failed" });
  expect(organizationSyncPausesUnreadable(failed)).toBe(true);

  const retrying = transitionOrganizationSyncPauseRead(failed, {
    read: secondRead,
    type: "start",
  });
  expect(retrying).toEqual({
    afterFailure: true,
    read: secondRead,
    status: "reading",
  });
  expect(organizationSyncPausesUnreadable(retrying)).toBe(true);

  const recovered = transitionOrganizationSyncPauseRead(retrying, {
    type: "succeed",
  });
  expect(recovered).toEqual({ read: secondRead, status: "read" });
  expect(organizationSyncPausesUnreadable(recovered)).toBe(false);
});

test("an event that does not belong to the state changes nothing", () => {
  expect(after({ type: "succeed" })).toBe(UNREAD_ORGANIZATION_SYNC_PAUSES);
  expect(after({ type: "fail" })).toBe(UNREAD_ORGANIZATION_SYNC_PAUSES);
  expect(organizationSyncPausesUnreadable(after())).toBe(false);
});
