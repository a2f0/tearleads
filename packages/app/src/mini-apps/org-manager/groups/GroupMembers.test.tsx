import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { compactFingerprint } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { GroupMembers } from "./GroupMembers";

afterEach(() => {
  cleanup();
});

test("group members use roster display names before user ids", () => {
  const namedUserId = "550e8400-e29b-41d4-a716-446655440000";
  const unnamedUserId = "550e8400-e29b-41d4-a716-446655440002";
  const view = render(
    <GroupMembers
      canMutateGroup={false}
      members={[
        { role: "member", userId: namedUserId },
        { role: "admin", userId: unnamedUserId },
        { role: "member", userId: "user-1" },
      ]}
      mutating={false}
      openRosterUser={() => undefined}
      profileDisplayNamesByUserId={new Map([[namedUserId, "Countess"]])}
      protectedUserId={null}
      protectSelf={false}
      removeMember={() => undefined}
      userId="user-1"
    />,
  );

  expect(view.getByText("Countess").getAttribute("title")).toBe(namedUserId);
  expect(
    view.getByText(compactFingerprint(unnamedUserId)).getAttribute("title"),
  ).toBe(unnamedUserId);
  expect(view.getByText(ORG_MANAGER_LABELS.self).getAttribute("title")).toBe(
    "user-1",
  );
});
