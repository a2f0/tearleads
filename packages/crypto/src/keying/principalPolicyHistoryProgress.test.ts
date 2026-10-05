import { beforeAll, expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createPrincipalPolicyHistoryVerifier,
  restorePrincipalPolicyHistoryVerifier,
} from "./principalPolicyHistory";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import type { PrincipalPolicyHistoryInput } from "./principalPolicyHistoryTypes";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type { KeyingVerificationResult } from "./types";

let fixture: Awaited<ReturnType<typeof historyFixture>>;
beforeAll(async () => {
  fixture = await historyFixture();
});

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function protection() {
  return {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "recovery-1",
  };
}

function scope(): PrincipalPolicyHistoryInput {
  return { principalId: fixture.shared.principalId, principalType: "group" };
}

function page(...entries: (typeof fixture.first)[]) {
  return {
    entries: entries.map((entry) => entry.entry),
    signerPublicKeys: [fixture.signer],
  };
}

test("locally authenticated progress resumes the exact verified prefix and retained references", async () => {
  const input = {
    ...scope(),
    retainedReferences: [
      historyHead(fixture.first.state),
      historyHead(fixture.third.state),
    ],
    localCheckpoint: {
      ...scope(),
      version: 2,
      stateHash: fixture.second.state.stateHash,
    },
  };
  const key = protection();
  const verifier = createPrincipalPolicyHistoryVerifier(input);
  accepted(await verifier.append(page(fixture.first)));
  const saved = accepted(await verifier.exportProgress(key));
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(input, saved, key),
  );
  const beforeCheckpoint = restored.finish(historyHead(fixture.first.state));
  expect(beforeCheckpoint.ok).toBe(false);
  if (!beforeCheckpoint.ok)
    expect(beforeCheckpoint.error.code).toBe("rollback");
  accepted(await restored.append(page(fixture.second, fixture.third)));
  const result = accepted(restored.finish(historyHead(fixture.third.state)));
  expect(result.retainedEntries.map((entry) => entry.state.version)).toEqual([
    1, 3,
  ]);
  const secondSaved = accepted(await restored.exportProgress(key));
  const secondRestore = accepted(
    await restorePrincipalPolicyHistoryVerifier(input, secondSaved, key),
  );
  expect(
    accepted(secondRestore.finish(historyHead(fixture.third.state))).checkpoint
      .version,
  ).toBe(3);
});

test("saved progress rejects another key, operation, principal, checkpoint or reference request", async () => {
  const input = scope();
  const key = protection();
  const verifier = createPrincipalPolicyHistoryVerifier(input);
  accepted(await verifier.append(page(fixture.first)));
  const saved = accepted(await verifier.exportProgress(key));
  const attempts = [
    { input, key: protection() },
    { input, key: { ...key, context: "recovery-2" } },
    {
      input: {
        ...input,
        localCheckpoint: {
          ...input,
          version: 3,
          stateHash: fixture.third.state.stateHash,
        },
      },
      key,
    },
    { input: { ...input, principalId: "another-group" }, key },
    { input: { ...input, principalType: "organization" as const }, key },
    {
      input: {
        ...input,
        retainedReferences: [historyHead(fixture.first.state)],
      },
      key,
    },
  ];
  for (const attempt of attempts) {
    const result = await restorePrincipalPolicyHistoryVerifier(
      attempt.input,
      saved,
      attempt.key,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
  }
});

test("saved progress rejects ciphertext changes and malformed framing", async () => {
  const key = protection();
  const verifier = fixture.create();
  accepted(await verifier.append(page(fixture.first)));
  const saved = accepted(await verifier.exportProgress(key));
  const [version, iv, ciphertext] = saved.split(".");
  if (!ciphertext) throw new Error("missing progress ciphertext");
  const bytes = base64ToBytes(ciphertext);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  const changed = await restorePrincipalPolicyHistoryVerifier(
    scope(),
    `${version}.${iv}.${bytesToBase64(bytes)}`,
    key,
  );
  expect(changed.ok).toBe(false);
  if (!changed.ok) expect(changed.error.code).toBe("hash_mismatch");
  for (const damaged of [
    saved.replace(/^v1\./, "v2."),
    `${saved}.extra`,
    "v1.invalid.invalid",
    `v1.${bytesToBase64(new Uint8Array(11))}.${ciphertext}`,
    `v1.${iv}.${bytesToBase64(new Uint8Array(15))}`,
    JSON.stringify(fixture.first),
  ]) {
    const result = await restorePrincipalPolicyHistoryVerifier(
      scope(),
      damaged,
      key,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_shape");
  }
});

test("a failed page never enters exported progress", async () => {
  const key = protection();
  const verifier = fixture.create();
  accepted(await verifier.append(page(fixture.first)));
  const forged = structuredClone(fixture.third);
  forged.entry.state.signature = fixture.first.state.signature;
  expect((await verifier.append(page(fixture.second, forged))).ok).toBe(false);
  const saved = accepted(await verifier.exportProgress(key));
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(scope(), saved, key),
  );
  expect(
    accepted(restored.finish(historyHead(fixture.first.state))).checkpoint
      .version,
  ).toBe(1);
  accepted(await restored.append(page(fixture.second, fixture.third)));
  expect(
    accepted(restored.finish(historyHead(fixture.third.state))).checkpoint
      .version,
  ).toBe(3);
});

test("export refuses an in-flight page and owns the captured key and prefix", async () => {
  const key = protection();
  const stableKey = { ...key, localKey: key.localKey.slice() };
  const verifier = fixture.create();
  const appending = verifier.append(page(fixture.first));
  expect((await verifier.exportProgress(key)).ok).toBe(false);
  accepted(await appending);
  const saving = verifier.exportProgress(key);
  key.localKey.fill(0);
  accepted(await verifier.append(page(fixture.second)));
  const saved = accepted(await saving);
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(scope(), saved, stableKey),
  );
  expect(
    accepted(restored.finish(historyHead(fixture.first.state))).checkpoint
      .version,
  ).toBe(1);
  expect(restored.finish(historyHead(fixture.second.state)).ok).toBe(false);
});

test("an empty verifier can resume without gaining a verified history", async () => {
  const key = protection();
  const verifier = fixture.create();
  const saved = accepted(await verifier.exportProgress(key));
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(scope(), saved, key),
  );
  expect(restored.finish(historyHead(fixture.first.state)).ok).toBe(false);
  expect((await restored.append(page(fixture.second))).ok).toBe(false);
  accepted(await restored.append(page(fixture.first)));
  expect(restored.finish(historyHead(fixture.first.state)).ok).toBe(true);
});

test("progress protection requires a 32-byte local key and nonempty context", async () => {
  const verifier = fixture.create();
  accepted(await verifier.append(page(fixture.first)));
  const key = protection();
  const saved = accepted(await verifier.exportProgress(key));
  for (const invalid of [
    { ...key, localKey: new Uint8Array(31) },
    { ...key, localKey: new Uint8Array(33) },
    { ...key, context: "" },
  ]) {
    const exported = await verifier.exportProgress(invalid);
    const restored = await restorePrincipalPolicyHistoryVerifier(
      scope(),
      saved,
      invalid,
    );
    for (const result of [exported, restored]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_shape");
    }
  }
  expect(verifier.finish(historyHead(fixture.first.state)).ok).toBe(true);
});

test("restoration owns its input scope and key before yielding", async () => {
  const verifier = fixture.create();
  accepted(await verifier.append(page(fixture.first)));
  const key = protection();
  const saved = accepted(await verifier.exportProgress(key));
  const input = { ...scope() };
  const restoring = restorePrincipalPolicyHistoryVerifier(input, saved, key);
  input.principalId = "changed-after-call";
  key.localKey.fill(0);
  key.context = "changed-after-call";
  const restored = accepted(await restoring);
  expect(restored.finish(historyHead(fixture.first.state)).ok).toBe(true);
});

test("an externally authorized empty genesis is verified before it can resume", async () => {
  const signer = await createPolicySigner("external-admin");
  const authority = await signPolicyState({
    principalId: "external-admins",
    members: [{ userId: signer.userId }],
    signer,
    version: 1,
    prevStateHash: null,
  });
  const authorityVerifier = createPrincipalPolicyHistoryVerifier({
    principalId: "external-admins",
    principalType: "group",
  });
  accepted(
    await authorityVerifier.append({
      entries: [authority.entry],
      signerPublicKeys: [signer],
    }),
  );
  const verifiedAuthority = accepted(
    authorityVerifier.finish(historyHead(authority.state)),
  );
  const head = {
    ...historyHead(verifiedAuthority.currentEntry.state),
    principalType: "group" as const,
  };
  const first = await signPolicyState({
    principalId: "empty-managed-group",
    members: [],
    projection: [],
    signer,
    version: 1,
    prevStateHash: null,
    externalAuthority: head,
  });
  const input = {
    principalId: "empty-managed-group",
    principalType: "group" as const,
  };
  const verifier = createPrincipalPolicyHistoryVerifier(input);
  const unsignedAuthority = await verifier.append({
    entries: [first.entry],
    signerPublicKeys: [signer],
  });
  expect(unsignedAuthority.ok).toBe(false);
  if (!unsignedAuthority.ok)
    expect(unsignedAuthority.error.code).toBe("unauthorized");
  accepted(
    await verifier.append({
      entries: [first.entry],
      signerPublicKeys: [signer],
      externalAuthority: {
        currentHead: head,
        states: [
          { head, projection: verifiedAuthority.currentEntry.projection },
        ],
      },
    }),
  );
  const key = protection();
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(
      input,
      accepted(await verifier.exportProgress(key)),
      key,
    ),
  );
  expect(
    accepted(restored.finish(historyHead(first.state))).currentEntry.projection,
  ).toHaveLength(0);
});
