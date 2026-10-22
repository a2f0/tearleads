import { expect, test } from "bun:test";
import { createDomainScope } from "../../workflows/sync";
import { retryWhenWritesSettle } from "./organizationMemberships";

test("a settle retry runs at once when the lanes are already idle", async () => {
  const domainScope = createDomainScope();
  let attempts = 0;

  retryWhenWritesSettle(domainScope, async () => {
    attempts += 1;
    return true;
  });
  await Promise.resolve();

  expect(attempts).toBe(1);
});
