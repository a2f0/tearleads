import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import type { OpenMiniAppRequest } from "../../types";
import { useOrgManagerRosterActions } from "./useOrgManagerRosterActions";

afterEach(() => cleanup());

function requireCapturedAction(
  action: ((userId: string) => void) | null,
): (userId: string) => void {
  if (!action) {
    throw new Error("Expected roster actions to be captured");
  }
  return action;
}

function RosterActionsProbe({
  capture,
  openMiniApp,
}: {
  capture: (importRosterUserIntoContacts: (userId: string) => void) => void;
  openMiniApp: (request: OpenMiniAppRequest) => void;
}) {
  const { importRosterUserIntoContacts } = useOrgManagerRosterActions({
    authUserId: "self",
    canDisableRosterUsers: false,
    contextMenu: null,
    directory: null,
    openMiniApp,
    selectUser: () => undefined,
    selectedRosterUser: null,
    setOrgManagerView: () => undefined,
  });
  useEffect(
    () => capture(importRosterUserIntoContacts),
    [capture, importRosterUserIntoContacts],
  );
  return null;
}

test("import into contacts imports immediately, not via the import dialog route", () => {
  const requests: OpenMiniAppRequest[] = [];
  let importRosterUserIntoContacts: ((userId: string) => void) | null = null;
  render(
    <RosterActionsProbe
      capture={(next) => {
        importRosterUserIntoContacts = next;
      }}
      openMiniApp={(request) => requests.push(request)}
    />,
  );
  requireCapturedAction(importRosterUserIntoContacts)("user-1");

  expect(requests).toHaveLength(1);
  const request = requests[0];
  expect(request?.appId).toBe("contacts");
  expect(request?.message).toEqual({
    appId: "contacts",
    type: "import-contact",
    userId: "user-1",
  });
  // The contact is created directly, so Contacts is not routed to its import
  // dialog anymore.
  expect(request?.pathSegments).toBeUndefined();
});
