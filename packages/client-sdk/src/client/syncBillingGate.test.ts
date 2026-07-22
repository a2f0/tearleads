import { expect, test } from "bun:test";
import { SyncBillingGate } from "./syncBillingGate";

test("starts with no blocked organization", () => {
  const gate = new SyncBillingGate();
  expect(gate.blockedOrganizationId).toBe(null);
});

test("notifies subscribers with the blocked org on the first 402", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe((organizationId) => seen.push(organizationId));

  gate.notifyPaymentRequired("org-1");

  expect(seen).toEqual(["org-1"]);
  expect(gate.blockedOrganizationId).toBe("org-1");
});

test("notifies on a first block with an unknown (null) org id", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe((organizationId) => seen.push(organizationId));

  // A 402 whose body omits the org id notifies with null; the fresh gate must
  // not coalesce this against its initial state.
  gate.notifyPaymentRequired(null);

  expect(seen).toEqual([null]);
  expect(gate.blockedOrganizationId).toBe(null);
});

test("coalesces repeated 402s for the same org into a single notify", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe((organizationId) => seen.push(organizationId));

  gate.notifyPaymentRequired("org-1");
  gate.notifyPaymentRequired("org-1");
  gate.notifyPaymentRequired("org-1");

  expect(seen).toEqual(["org-1"]);
});

test("isolates an identified payment block to its organization", () => {
  const gate = new SyncBillingGate();

  gate.notifyPaymentRequired("custom-org");

  expect(gate.isBlockedForOrganization("custom-org")).toBe(true);
  expect(gate.isBlockedForOrganization("personal-org")).toBe(false);
  expect(gate.isBlockedForOrganization(null)).toBe(false);
});

test("retains simultaneous blocks for separate organizations", () => {
  const gate = new SyncBillingGate();

  gate.notifyPaymentRequired("custom-org-a");
  gate.notifyPaymentRequired("custom-org-b");

  expect(gate.isBlockedForOrganization("custom-org-a")).toBe(true);
  expect(gate.isBlockedForOrganization("custom-org-b")).toBe(true);
  expect(gate.isBlockedForOrganization("personal-org")).toBe(false);
  expect(gate.blockedOrganizationId).toBe("custom-org-b");
});

test("clears only the recovered organization block", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe((organizationId) => seen.push(organizationId));
  gate.notifyPaymentRequired("custom-org-a");
  gate.notifyPaymentRequired("custom-org-b");

  gate.clearBlock("custom-org-a");

  expect(gate.isBlockedForOrganization("custom-org-a")).toBe(false);
  expect(gate.isBlockedForOrganization("custom-org-b")).toBe(true);
  expect(gate.isBlocked).toBe(true);
  expect(seen).toEqual(["custom-org-a", "custom-org-b"]);

  gate.notifyPaymentRequired("custom-org-a");
  expect(seen).toEqual(["custom-org-a", "custom-org-b", "custom-org-a"]);
});

test("re-notifies for the same org after clearBlock (re-activation)", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe((organizationId) => seen.push(organizationId));

  gate.notifyPaymentRequired("org-1");
  expect(gate.isBlocked).toBe(true);
  // Billing recovers (re-activation) and the app resets the gate...
  gate.clearBlock();
  expect(gate.isBlocked).toBe(false);
  // ...so a later lapse for the same org signals again instead of coalescing.
  gate.notifyPaymentRequired("org-1");

  expect(seen).toEqual(["org-1", "org-1"]);
  expect(gate.blockedOrganizationId).toBe("org-1");
  expect(gate.isBlocked).toBe(true);
});

test("clearBlock does not notify subscribers", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.notifyPaymentRequired("org-1");
  expect(gate.isBlocked).toBe(true);
  gate.subscribe((organizationId) => seen.push(organizationId));

  gate.clearBlock();

  expect(seen).toEqual([]);
  expect(gate.blockedOrganizationId).toBe(null);
  expect(gate.isBlocked).toBe(false);
});

test("isBlocked is true after a block with an unknown (null) org", () => {
  const gate = new SyncBillingGate();
  expect(gate.isBlocked).toBe(false);

  // A 402 whose body omits the org id blocks with a null org — isBlocked must
  // still report true so re-activation re-drives the stranded sync lanes.
  gate.notifyPaymentRequired(null);

  expect(gate.isBlocked).toBe(true);
  expect(gate.blockedOrganizationId).toBe(null);
  expect(gate.isBlockedForOrganization("org-1")).toBe(true);
  expect(gate.isBlockedForOrganization("org-2")).toBe(true);
});

test("listBlocksOutsideOrganization omits the active organization's own block", () => {
  const gate = new SyncBillingGate();
  expect(gate.listBlocksOutsideOrganization("personal-org")).toEqual([]);

  gate.notifyPaymentRequired("personal-org");

  expect(gate.listBlocksOutsideOrganization("personal-org")).toEqual([]);
  expect(gate.listBlocksOutsideOrganization("custom-org")).toEqual([
    "personal-org",
  ]);
  expect(gate.listBlocksOutsideOrganization(null)).toEqual(["personal-org"]);
});

test("listBlocksOutsideOrganization drops an organization once recovered", () => {
  const gate = new SyncBillingGate();
  gate.notifyPaymentRequired("custom-org-a");
  gate.notifyPaymentRequired("custom-org-b");

  expect(gate.listBlocksOutsideOrganization("personal-org")).toEqual([
    "custom-org-a",
    "custom-org-b",
  ]);

  gate.clearBlock("custom-org-a");

  expect(gate.listBlocksOutsideOrganization("personal-org")).toEqual([
    "custom-org-b",
  ]);
});

test("listBlocksOutsideOrganization omits an unknown-org block", () => {
  const gate = new SyncBillingGate();

  // An anonymous 402 names no organization, so its billing cannot be resolved
  // to tell a lapse apart from a free `local` org. isBlocked still reports it.
  gate.notifyPaymentRequired(null);

  expect(gate.listBlocksOutsideOrganization("personal-org")).toEqual([]);
  expect(gate.isBlocked).toBe(true);
});

test("a named recovery only exempts that organization from an unknown block", () => {
  const gate = new SyncBillingGate();
  gate.notifyPaymentRequired("org-1");
  gate.notifyPaymentRequired(null);

  gate.clearBlock("org-2");

  expect(gate.isBlockedForOrganization("org-1")).toBe(true);
  expect(gate.isBlockedForOrganization("org-2")).toBe(false);
  expect(gate.isBlockedForOrganization("org-3")).toBe(true);
  expect(gate.blockedOrganizationId).toBe(null);
});

test("a new unknown block revokes earlier organization exemptions", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe((organizationId) => seen.push(organizationId));
  gate.notifyPaymentRequired(null);
  gate.clearBlock("org-1");
  expect(gate.isBlockedForOrganization("org-1")).toBe(false);

  gate.notifyPaymentRequired(null);

  expect(gate.isBlockedForOrganization("org-1")).toBe(true);
  expect(seen).toEqual([null, null]);
});

test("notifies again when the blocked org changes", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe((organizationId) => seen.push(organizationId));

  gate.notifyPaymentRequired("org-1");
  gate.notifyPaymentRequired("org-2");

  expect(seen).toEqual(["org-1", "org-2"]);
});

test("stops notifying after unsubscribe", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  const unsubscribe = gate.subscribe((organizationId) =>
    seen.push(organizationId),
  );

  gate.notifyPaymentRequired("org-1");
  unsubscribe();
  gate.notifyPaymentRequired("org-2");

  expect(seen).toEqual(["org-1"]);
});

test("isolates a throwing subscriber from the others", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe(() => {
    throw new Error("boom");
  });
  gate.subscribe((organizationId) => seen.push(organizationId));

  gate.notifyPaymentRequired("org-1");

  expect(seen).toEqual(["org-1"]);
});
