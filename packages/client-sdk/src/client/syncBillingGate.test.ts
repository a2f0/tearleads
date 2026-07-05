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

test("coalesces repeated 402s for the same org into a single notify", () => {
  const gate = new SyncBillingGate();
  const seen: (string | null)[] = [];
  gate.subscribe((organizationId) => seen.push(organizationId));

  gate.notifyPaymentRequired("org-1");
  gate.notifyPaymentRequired("org-1");
  gate.notifyPaymentRequired("org-1");

  expect(seen).toEqual(["org-1"]);
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
