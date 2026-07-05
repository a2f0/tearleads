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
