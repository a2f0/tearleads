import { beforeAll, expect, test } from "bun:test";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import type { ProjectionPolicyHistoryEvidenceResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import {
  principalHistoryEntries,
  principalHistoryPrefixes,
} from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverProjectionPolicyHistory } from "./recoverProjectionPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture(extra = history.admin) {
  const f = await createPublicHistoryFixture(
    { ...history, bundle: history.group },
    [history.admin, history.directory, extra],
  );
  const evidence: ProjectionPolicyHistoryEvidenceResponse = {
    organization: f.source(history.directory),
    organizationPayloads: [
      {
        reference: principalPolicyHead(history.directory),
        payload: history.directory.currentPayload,
      },
    ],
    groups: [f.source(history.admin), f.source(history.group)],
  };
  return {
    ...f,
    options: {
      ...f.options,
      evidence,
      organizationId: history.organizationId,
      references: [principalPolicyHead(history.created)],
    },
  };
}

test("public projection recovery verifies directory, strict Admins and historical group citations over HTTP", async () => {
  const f = await fixture();
  try {
    const policies = await recoverProjectionPolicyHistory(f.options);
    expect(policies).toHaveLength(3);
    const group = policies.find(
      (policy) => policy.principalId === history.group.currentState.principalId,
    );
    if (!group) throw new Error("Missing selected group");
    expect(
      principalPolicyMatchesReference({
        policy: group,
        reference: principalPolicyHead(history.created),
      }),
    ).toBe(true);
    expect(group.retainedHistory.map(({ state }) => state.version)).toEqual([
      1, 66,
    ]);
    expect(
      policies.find((policy) => policy.principalType === "organization")
        ?.retainedHistory[0]?.state.version,
    ).toBe(1);
    expect(f.requests).toEqual([0, 32, 64, 0, 32, 64, 0, 32, 64]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    expect(
      (await f.db.select().from(principalHistoryPrefixes)).map(
        (row) => row.currentJson,
      ),
    ).toEqual(["null", "null", "null"]);
    f.requests.length = 0;
    const offline = await recoverProjectionPolicyHistory({
      ...f.options,
      offline: true,
    });
    expect(offline.map((policy) => policy.stateHash)).toEqual(
      policies.map((policy) => policy.stateHash),
    );
    expect(f.requests).toEqual([]);
  } finally {
    f.close();
  }
});

test("a valid foreign group cannot borrow this organization's directory", async () => {
  const foreign = await history.createGroup("Foreign group");
  const f = await fixture(foreign);
  try {
    f.options.evidence.groups.push(f.source(foreign));
    await expect(recoverProjectionPolicyHistory(f.options)).rejects.toThrow(
      "group source lacks its signed directory binding",
    );
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("lost selected evidence replays only that principal and cannot be used offline", async () => {
  const f = await fixture();
  try {
    await recoverProjectionPolicyHistory(f.options);
    const rows = await f.db.select().from(principalHistoryEntries);
    const row = rows.find((candidate) => {
      const state = JSON.parse(candidate.entryJson).state;
      return (
        state.principalId === history.group.currentState.principalId &&
        state.version === 1
      );
    });
    if (!row) throw new Error("Missing selected group entry");
    const entry = JSON.parse(row.entryJson);
    entry.state.signature = history.group.currentState.signature;
    await f.db
      .update(principalHistoryEntries)
      .set({ entryJson: JSON.stringify(entry) })
      .where(eq(principalHistoryEntries.leafHash, row.leafHash))
      .run();
    f.requests.length = 0;
    await expect(
      recoverProjectionPolicyHistory({ ...f.options, offline: true }),
    ).rejects.toThrow("proof root does not match");
    expect(f.requests).toEqual([]);
    await recoverProjectionPolicyHistory(f.options);
    expect(f.requests).toEqual([65, 65, 65, 0, 32, 64]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test.each([
  "ciphertext",
  "payload-reference",
  "group-head",
  "organization",
] as const)(
  "public projection recovery rejects substituted %s evidence",
  async (change) => {
    const f = await fixture();
    try {
      await recoverProjectionPolicyHistory(f.options);
      const evidence = structuredClone(f.options.evidence);
      const payload = evidence.organizationPayloads[0];
      const group = evidence.groups[1];
      if (!payload || !group || !evidence.organization)
        throw new Error("Missing fixture evidence");
      if (change === "ciphertext") payload.payload.ciphertext += " ";
      if (change === "payload-reference")
        payload.reference.stateHash = "0".repeat(64);
      if (change === "group-head") group.head.keyFingerprint = "0".repeat(64);
      if (change === "organization")
        evidence.organization.head.principalId = crypto.randomUUID();
      await expect(
        recoverProjectionPolicyHistory({ ...f.options, evidence }),
      ).rejects.toMatchObject({ code: "object_mismatch" });
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test("public projection recovery refuses a conflicting durable pin without changing it", async () => {
  const f = await fixture();
  try {
    await recoverProjectionPolicyHistory(f.options);
    const pin = {
      principalType: "group" as const,
      principalId: history.group.currentState.principalId,
      version: 16,
      stateHash: "0".repeat(64),
      updatedAt: history.group.currentState.createdAt,
    };
    await f.db.insert(principalPolicyCheckpoints).values(pin).run();
    await expect(
      recoverProjectionPolicyHistory(f.options),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([pin]);
  } finally {
    f.close();
  }
});
