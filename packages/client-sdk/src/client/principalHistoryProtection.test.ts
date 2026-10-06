import { expect, test } from "bun:test";
import { isProjectionVerificationCancelledError } from "../data/keyingProjectionVerification/types";
import { createPrincipalHistoryProtectionCustody } from "./principalHistoryProtection";

async function expectCancellation(operation: Promise<unknown>) {
  const error = await operation.then(
    () => null,
    (error: unknown) => error,
  );
  expect(isProjectionVerificationCancelledError(error)).toBe(true);
}

function scope() {
  return {
    database: {},
    generation: 1,
    signingFingerprint: "signer-a",
    identityTrustDomain: "https://api.example.test",
  };
}

test("headless keys are private to a custody instance and retired with its lifetime", async () => {
  const current = scope();
  const custody = createPrincipalHistoryProtectionCustody({
    readScope: () => current,
  });
  const first = custody.bind();
  if (!first) throw new Error("Missing key lease");
  let owned: Uint8Array | undefined;
  const original = await first(async ({ protection }) => {
    owned = protection.localKey;
    return new Uint8Array(protection.localKey);
  });
  expect(owned).toEqual(new Uint8Array(32));
  expect(
    await first(async ({ protection }) => new Uint8Array(protection.localKey)),
  ).toEqual(original);
  custody.retire();
  await expectCancellation(first(async () => true));
  const next = custody.bind();
  if (!next) throw new Error("Missing replacement lease");
  expect(
    await next(async ({ protection }) => new Uint8Array(protection.localKey)),
  ).not.toEqual(original);
  const restarted = createPrincipalHistoryProtectionCustody({
    readScope: () => current,
  }).bind();
  if (!restarted) throw new Error("Missing restarted lease");
  expect(
    await restarted(
      async ({ protection }) => new Uint8Array(protection.localKey),
    ),
  ).not.toEqual(original);
});

test.each(["database", "identity", "domain", "generation"] as const)(
  "a changed %s rejects an outstanding host key and clears it",
  async (change) => {
    let current = scope();
    const pending = Promise.withResolvers<Uint8Array>();
    const custody = createPrincipalHistoryProtectionCustody({
      readScope: () => current,
      keyProvider: () => pending.promise,
    });
    const lease = custody.bind();
    if (!lease) throw new Error("Missing key lease");
    let called = false;
    const result = lease(async () => {
      called = true;
    });
    if (change === "database") current = { ...current, database: {} };
    if (change === "identity")
      current = { ...current, signingFingerprint: "signer-b" };
    if (change === "domain")
      current = {
        ...current,
        identityTrustDomain: "https://other.example.test",
      };
    if (change === "generation") current = { ...current, generation: 2 };
    const key = new Uint8Array(32).fill(9);
    pending.resolve(key);
    await expectCancellation(result);
    expect(called).toBe(false);
    expect(key).toEqual(new Uint8Array(32));
  },
);

test("a lifetime change during recovery prevents returning its result", async () => {
  const current = scope();
  const custody = createPrincipalHistoryProtectionCustody({
    readScope: () => current,
  });
  const lease = custody.bind();
  if (!lease) throw new Error("Missing key lease");
  let owned: Uint8Array | undefined;
  await expectCancellation(
    lease(async ({ protection, stillCurrent }) => {
      owned = protection.localKey;
      expect(stillCurrent()).toBe(true);
      custody.retire();
      expect(stillCurrent()).toBe(false);
      return "stale policy";
    }),
  );
  expect(owned).toEqual(new Uint8Array(32));
});

test("host keys bind the trust context and are cleared on operation failure", async () => {
  const current = scope();
  const key = new Uint8Array(32).fill(7);
  const requests: unknown[] = [];
  const lease = createPrincipalHistoryProtectionCustody({
    readScope: () => current,
    keyProvider: async (scope) => {
      requests.push(scope);
      return key;
    },
  }).bind();
  if (!lease) throw new Error("Missing key lease");
  await expect(
    lease(async ({ protection }) => {
      expect(JSON.parse(protection.context)).toEqual([
        "tearleads.sdk.principal-history.runtime.v1",
        current.identityTrustDomain,
        current.signingFingerprint,
      ]);
      throw new Error("Interrupted history");
    }),
  ).rejects.toThrow("Interrupted history");
  expect(requests).toEqual([
    {
      identityTrustDomain: current.identityTrustDomain,
      signingFingerprint: current.signingFingerprint,
    },
  ]);
  expect(key).toEqual(new Uint8Array(32));
});

test("missing runtime scope and malformed host keys cannot start recovery", async () => {
  expect(
    createPrincipalHistoryProtectionCustody({ readScope: () => null }).bind(),
  ).toBeUndefined();
  const key = new Uint8Array(31).fill(9);
  const current = scope();
  const validLease = createPrincipalHistoryProtectionCustody({
    readScope: () => current,
    keyProvider: async () => key,
  }).bind();
  if (!validLease) throw new Error("Missing key lease");
  await expect(validLease(async () => true)).rejects.toMatchObject({
    code: "invalid_shape",
  });
  expect(key).toEqual(new Uint8Array(31));
});
