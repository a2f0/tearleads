import { beforeAll, expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { principalGrantRetirements } from "../../data/sqlite/principalGrantRetirementSchema";
import {
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../../data/sqlite/principalHistoryEvidenceSchema";
import {
  principalHistoryStageScopes,
  principalKeyEnvelopeArchive,
} from "../../data/sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createExecSql } from "../../data/sqlite/sqlSchema";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function snapshot(
  f: Awaited<ReturnType<typeof currentPolicyPublicationFixture>>,
) {
  const rows = await Promise.all([
    f.db.select().from(principalHistoryPrefixes),
    f.db.select().from(principalHistoryStages),
    f.db.select().from(principalHistoryStageScopes),
    f.db.select().from(principalKeyEnvelopeArchive),
    f.db.select().from(principalHistoryEntries),
    f.db.select().from(principalHistoryNodes),
    f.db.select().from(principalPolicyCheckpoints),
    f.db.select().from(principalGrantRetirements),
  ]);
  return toFingerprint(new TextEncoder().encode(JSON.stringify(rows)));
}

test("a second-policy checkpoint failure rolls back both current publications and retirements", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    const before = await snapshot(f);
    await f.options.execSql(`CREATE TRIGGER reject_second_current_checkpoint
      BEFORE INSERT ON principal_policy_checkpoints
      WHEN NEW.principal_type = 'organization'
      BEGIN SELECT RAISE(ABORT, 'injected second checkpoint failure'); END`);
    const grant = f.input.request.grants[0];
    if (!grant) throw new Error("Missing signed grant");
    await expect(
      retainAcknowledgedPrincipalCurrents({
        ...f.publication,
        retirements: [
          {
            principalId: history.group.currentState.principalId,
            principalType: "group",
            containerIds: [grant.containerId],
          },
        ],
      }),
    ).rejects.toThrow('insert into "principal_policy_checkpoints"');
    expect(await snapshot(f)).toBe(before);
  } finally {
    f.close();
  }
});

test.each(["missing", "conflicting", "newer"] as const)(
  "a %s durable pin rejects the whole current publication",
  async (kind) => {
    const f = await currentPolicyPublicationFixture(history);
    try {
      const selected = eq(
        principalPolicyCheckpoints.principalId,
        history.organizationId,
      );
      if (kind === "missing")
        await f.db.delete(principalPolicyCheckpoints).where(selected).run();
      else
        await f.db
          .update(principalPolicyCheckpoints)
          .set({
            stateHash: "f".repeat(64),
            version: kind === "newer" ? 68 : 66,
          })
          .where(selected)
          .run();
      const before = await snapshot(f);
      await expect(
        retainAcknowledgedPrincipalCurrents(f.publication),
      ).rejects.toMatchObject({
        code: kind === "newer" ? "rollback" : "stale_predecessor",
      });
      expect(await snapshot(f)).toBe(before);
    } finally {
      f.close();
    }
  },
);

test("a concurrent prefix replacement survives a losing acknowledgement", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    let concurrent = "";
    const entries = f.publication.entries.map((entry, index) =>
      index !== 0
        ? entry
        : {
            ...entry,
            recovery: {
              ...entry.recovery,
              loadExternalAuthority: async () => {
                const prefixes = await f.db
                  .select()
                  .from(principalHistoryPrefixes);
                const group = prefixes.find(
                  (prefix) =>
                    JSON.parse(prefix.headJson).principalId ===
                    history.group.currentState.principalId,
                );
                if (!group) throw new Error("Missing current group prefix");
                await f.db
                  .update(principalHistoryPrefixes)
                  .set({ progress: "concurrent cache replacement" })
                  .where(eq(principalHistoryPrefixes.scopeId, group.scopeId))
                  .run();
                concurrent = await snapshot(f);
                return f.input.externalAuthority;
              },
            },
          },
    );
    await expect(
      retainAcknowledgedPrincipalCurrents({ ...f.publication, entries }),
    ).rejects.toThrow("prefix changed before acknowledgement");
    expect(concurrent).not.toBe("");
    expect(await snapshot(f)).toBe(concurrent);
  } finally {
    f.close();
  }
});

test.each(["generation", "signal"] as const)(
  "%s expiry after the first current artifact write rolls back the whole transaction",
  async (kind) => {
    const f = await currentPolicyPublicationFixture(history);
    try {
      const before = await snapshot(f);
      let wrote = false;
      const controller = new AbortController();
      const entries = f.publication.entries.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              recovery: { ...entry.recovery, signal: controller.signal },
            }
          : entry,
      );
      const execSql = createExecSql({
        exec: async ({ sql, bind, rowMode }) => {
          const rows = await f.options.execSql(
            sql,
            bind,
            rowMode ? { rowMode } : undefined,
          );
          if (sql.startsWith('insert into "principal_history_prefixes"')) {
            wrote = true;
            if (kind === "signal") controller.abort();
            else f.lifetime.current = false;
          }
          return { rows };
        },
      });
      await expect(
        retainAcknowledgedPrincipalCurrents({
          ...f.publication,
          entries,
          execSql,
        }),
      ).rejects.toThrow("generation expired");
      expect(wrote).toBe(true);
      expect(await snapshot(f)).toBe(before);
    } finally {
      f.close();
    }
  },
);

test("duplicate policies and unsigned grant retirements cannot be published", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    const before = await snapshot(f);
    await expect(
      retainAcknowledgedPrincipalCurrents({
        ...f.publication,
        entries: [...f.publication.entries, ...f.publication.entries],
      }),
    ).rejects.toMatchObject({ code: "duplicate_entry" });
    await expect(
      retainAcknowledgedPrincipalCurrents({
        ...f.publication,
        retirements: [
          {
            principalId: history.group.currentState.principalId,
            principalType: "group",
            containerIds: ["unsigned-container"],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    expect(await snapshot(f)).toBe(before);
  } finally {
    f.close();
  }
});
