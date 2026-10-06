import { beforeAll, expect, test } from "bun:test";
import { restorePrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import { appendPrincipalHistoryIndex } from "./principalPolicyHistoryIndex";
import {
  ownPrincipalHistoryProgressProtection,
  sealPrincipalHistoryProgress,
} from "./principalPolicyHistoryProgressProtection";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import type { PrincipalPolicyHistoryInput } from "./principalPolicyHistoryTypes";
import { signPolicyState } from "./principalPolicyTestFixtures";

let fixture: Awaited<ReturnType<typeof historyFixture>>;
let firstFrontier: readonly (string | null)[];
let secondFrontier: readonly (string | null)[];
let foreign: Awaited<ReturnType<typeof signPolicyState>>;
let external: Awaited<ReturnType<typeof signPolicyState>>;
beforeAll(async () => {
  fixture = await historyFixture();
  firstFrontier = (await appendPrincipalHistoryIndex([], [fixture.first.state]))
    .frontier;
  secondFrontier = (
    await appendPrincipalHistoryIndex(firstFrontier, [fixture.second.state])
  ).frontier;
  foreign = await signPolicyState({
    ...fixture.shared,
    principalId: "different-principal",
    signer: fixture.signer,
    version: 1,
    prevStateHash: null,
  });
  external = await signPolicyState({
    ...fixture.shared,
    signer: fixture.signer,
    members: [],
    projection: [],
    version: 1,
    prevStateHash: null,
    externalAuthority: {
      ...historyHead(foreign.state),
      principalType: "group",
    },
  });
});

function scope(): PrincipalPolicyHistoryInput {
  return { principalId: fixture.shared.principalId, principalType: "group" };
}

function progress() {
  return {
    previous: fixture.first.entry,
    indexFrontier: firstFrontier,
    latestAuthority: null,
    checkpointHash: null,
    retained: [],
  };
}

// These are deliberately authenticated with a local test key so each case
// reaches validation after decryption. They do not simulate an API knowing it.
async function restore(value: unknown, input = scope()) {
  const options = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "authenticated-shape-tests",
  };
  const sealed = await sealPrincipalHistoryProgress(
    JSON.stringify(value),
    ownPrincipalHistoryProgressProtection(
      normalizePrincipalHistoryInput(input),
      options,
    ),
  );
  return restorePrincipalPolicyHistoryVerifier(input, sealed, options);
}

test("valid authenticated plaintext restores before malformed variants are checked", async () => {
  const result = await restore(progress());
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.value.finish(historyHead(fixture.first.state)).ok).toBe(true);
});

test.each([
  [
    "wrong principal",
    () => ({ ...progress(), previous: foreign.entry }),
    "object_mismatch",
    "saved principal history scope mismatch",
  ],
  [
    "empty prefix with authority",
    () => ({
      ...progress(),
      previous: null,
      indexFrontier: [],
      latestAuthority: historyHead(foreign.state),
    }),
    "invalid_shape",
    "empty principal progress carries history",
  ],
  [
    "non-group authority",
    () => ({
      ...progress(),
      latestAuthority: {
        ...historyHead(foreign.state),
        principalType: "organization",
      },
    }),
    "invalid_shape",
    "invalid saved principal authority",
  ],
  [
    "forgotten current authority",
    () => ({ ...progress(), previous: external.entry }),
    "invalid_shape",
    "saved principal authority is inconsistent",
  ],
  [
    "different current authority",
    () => ({
      ...progress(),
      previous: external.entry,
      latestAuthority: { ...historyHead(foreign.state), version: 2 },
    }),
    "invalid_shape",
    "saved principal authority is inconsistent",
  ],
  [
    "invented checkpoint",
    () => ({ ...progress(), checkpointHash: fixture.first.state.stateHash }),
    "stale_predecessor",
    "saved principal checkpoint is inconsistent",
  ],
  [
    "unrequested retained entry",
    () => ({ ...progress(), retained: [fixture.first.entry] }),
    "missing_dependency",
    "saved principal references are incomplete",
  ],
  [
    "retained count above budget",
    () => ({ ...progress(), retained: Array(129).fill(fixture.first.entry) }),
    "invalid_shape",
    "invalid retained principal progress",
  ],
  [
    "non-array retained entries",
    () => ({ ...progress(), retained: null }),
    "invalid_shape",
    "invalid retained principal progress",
  ],
] as const)(
  "authenticated progress rejects %s",
  async (_label, value, code, message) => {
    const result = await restore(value());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.message).toBe(message);
    }
  },
);

test("authenticated progress cannot omit an already reached checkpoint", async () => {
  const input = {
    ...scope(),
    localCheckpoint: {
      ...scope(),
      version: 1,
      stateHash: fixture.first.state.stateHash,
    },
  };
  const valid = await restore(
    {
      ...progress(),
      checkpointHash: fixture.first.state.stateHash,
      retained: [fixture.first.entry],
    },
    input,
  );
  expect(valid.ok).toBe(true);
  const result = await restore(progress(), input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("stale_predecessor");
});

test("authenticated progress retains the signed checkpoint entry for atomic admission", async () => {
  const input = {
    ...scope(),
    localCheckpoint: {
      ...scope(),
      version: 1,
      stateHash: fixture.first.state.stateHash,
    },
  };
  const result = await restore(
    { ...progress(), checkpointHash: fixture.first.state.stateHash },
    input,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("missing_dependency");
});

test("authenticated checkpoint retention rejects 130 entries before normalization", async () => {
  const result = await restore(
    { ...progress(), retained: Array(130).fill(null) },
    {
      ...scope(),
      localCheckpoint: {
        ...scope(),
        version: 1,
        stateHash: fixture.first.state.stateHash,
      },
    },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("invalid_shape");
    expect(result.error.message).toBe("invalid retained principal progress");
  }
});

test("authenticated checkpoint retention rejects a signed fork at the same version", async () => {
  const fork = await signPolicyState({
    ...fixture.shared,
    version: 1,
    prevStateHash: null,
    signedAt: "2026-01-02T00:00:00.000Z",
  });
  expect(fork.state.stateHash).not.toBe(fixture.first.state.stateHash);
  const result = await restore(
    {
      ...progress(),
      checkpointHash: fixture.first.state.stateHash,
      retained: [fork.entry],
    },
    {
      ...scope(),
      localCheckpoint: {
        ...scope(),
        version: 1,
        stateHash: fixture.first.state.stateHash,
      },
    },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("missing_dependency");
});

test.each(["missing", "duplicate", "substituted"] as const)(
  "authenticated retained references reject %s evidence",
  async (kind) => {
    const input = {
      ...scope(),
      retainedReferences: [
        historyHead(fixture.first.state),
        historyHead(fixture.second.state),
      ],
    };
    const valid = {
      ...progress(),
      previous: fixture.second.entry,
      indexFrontier: secondFrontier,
      retained: [fixture.first.entry, fixture.second.entry],
    };
    expect((await restore(valid, input)).ok).toBe(true);
    const retained =
      kind === "missing"
        ? [fixture.first.entry]
        : kind === "duplicate"
          ? [fixture.first.entry, fixture.first.entry]
          : [fixture.first.entry, fixture.third.entry];
    const result = await restore({ ...valid, retained }, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("missing_dependency");
  },
);

test.each([
  ["missing state", () => ({ ...fixture.first.entry, state: null })],
  [
    "invalid state scalar",
    () => ({
      ...fixture.first.entry,
      state: { ...fixture.first.state, version: "1" },
    }),
  ],
  [
    "invalid nested authority",
    () => ({
      ...external.entry,
      state: {
        ...external.state,
        externalAuthority: {
          ...external.state.externalAuthority,
          version: "1",
        },
      },
    }),
  ],
  [
    "invalid projection array",
    () => ({ ...fixture.first.entry, projection: null }),
  ],
  [
    "invalid member",
    () => ({
      ...fixture.first.entry,
      projection: [{ userId: fixture.signer.userId, role: "owner" }],
    }),
  ],
  ["invalid grants array", () => ({ ...fixture.first.entry, grants: null })],
  [
    "invalid grant",
    () => ({
      ...fixture.first.entry,
      grants: [{ containerId: "container", accessLevel: "owner" }],
    }),
  ],
] as const)("authenticated entry rejects %s", async (_label, entry) => {
  const result = await restore({ ...progress(), previous: entry() });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("invalid_shape");
    expect(result.error.message).toBe(
      "saved principal history entry is malformed",
    );
  }
});

test("authenticated entries still enforce signed state and projection commitments", async () => {
  for (const entry of [
    {
      ...fixture.first.entry,
      state: { ...fixture.first.state, stateHash: "0".repeat(64) },
    },
    {
      ...fixture.first.entry,
      projection: [{ userId: fixture.signer.userId, role: "member" }],
    },
  ]) {
    const result = await restore({ ...progress(), previous: entry });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
  }
});

test("authenticated progress and entries reject extra structural keys", async () => {
  for (const value of [
    { ...progress(), unknown: true },
    { ...progress(), previous: { ...fixture.first.entry, unknown: true } },
  ]) {
    const result = await restore(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_shape");
      expect(result.error.message).toContain("unexpected keys");
    }
  }
});
