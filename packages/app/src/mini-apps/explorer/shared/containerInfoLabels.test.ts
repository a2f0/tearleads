import { expect, test } from "bun:test";
import { EXPLORER_CONTAINER_INFO_LABELS } from "./containerInfoLabels";

test("recipient admission failures offer a fix without promising read-only access", () => {
  expect(
    EXPLORER_CONTAINER_INFO_LABELS.containerInfoShareToUserNeedsIdentityLink,
  ).toBe(
    "This device could not authenticate the recipient. Verify their identity link and try sharing again.",
  );
});
