import { expect, test } from "bun:test";
import {
  beginPrincipalHistoryVerification,
  withPrincipalHistoryRequest,
} from "./principalHistoryWork";

test("history work invokes only its own request capability, once, across concurrent awaits", async () => {
  const calls: string[] = [];
  await Promise.all(
    ["first", "second", "ordinary"].map((id) =>
      withPrincipalHistoryRequest(
        () => calls.push(id),
        async () => {
          await Promise.resolve();
          if (id === "ordinary") return;
          beginPrincipalHistoryVerification();
          await Promise.resolve();
          beginPrincipalHistoryVerification();
        },
      ),
    ),
  );
  // A later background call outside any authenticated request inherits nothing.
  beginPrincipalHistoryVerification();
  expect(calls).toEqual(["first", "second"]);
});
