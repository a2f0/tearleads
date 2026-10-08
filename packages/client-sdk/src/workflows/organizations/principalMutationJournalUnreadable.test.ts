import { expect, test } from "bun:test";
import { sign } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalMutationJournalFixture } from "../../../test/helpers/principalMutationJournalFixture";
import {
  claimPrincipalMutationJournal,
  loadPrincipalMutationJournal,
} from "../../data/persistence/principalMutationJournalPersistence";
import { sealPrincipalMutation } from "../../data/principals/principalMutationJournal";
import {
  principalMutationJournalRecordId,
  UnreadablePrincipalMutationError,
} from "../../data/principals/principalMutationJournalRecord";
import {
  discardUnreadableJournaledPrincipalMutation,
  readJournaledPrincipalMutation,
} from "./principalMutationJournalManagement";
import { recoverJournaledPrincipalMutation } from "./principalMutationJournalSession";

async function fixture(format = false) {
  const signed = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("journal-unreadable-discard");
  let current = true;
  const input = {
    ...signed,
    execSql: sqlite.execSql,
    stillCurrent: () => current,
  };
  const row = await sealPrincipalMutation(signed);
  if (format) {
    // Authenticate a body unsupported by this SDK; its bytes are never submitted.
    row.serializedRequest = JSON.stringify({
      groupId: signed.mutation.groupId,
      request: { futureFormat: true },
    });
    const scope = JSON.stringify([
      "tearleads.sdk.principal-mutation.v1",
      signed.scope.identityTrustDomain,
      signed.scope.organizationId,
      signed.scope.userId,
      signed.scope.signingFingerprint,
    ]);
    row.signature = bytesToBase64(
      sign(
        new TextEncoder().encode(
          JSON.stringify([scope, row.serializedRequest]),
        ),
        signed.signingKeyPair.signingPrivateKey,
      ),
    );
  } else row.signature = "corrupt";
  try {
    await claimPrincipalMutationJournal({ ...input, row });
    return {
      input,
      row,
      close: sqlite.close,
      expire() {
        current = false;
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

async function inspected(
  input: Parameters<typeof readJournaledPrincipalMutation>[0],
) {
  const error = await readJournaledPrincipalMutation(input).catch(
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(UnreadablePrincipalMutationError);
  if (!(error instanceof UnreadablePrincipalMutationError))
    throw new Error("Missing unreadable record inspection");
  return error;
}

test.each([false, true])(
  "explicit discard retires unreadable work without submission: authenticated format=%s",
  async (format) => {
    const f = await fixture(format);
    let submissions = 0;
    try {
      const inspection = await inspected(f.input);
      expect(inspection.reason).toBe(format ? "format" : "authentication");
      await expect(
        recoverJournaledPrincipalMutation({
          ...f.input,
          submit: async () => {
            submissions += 1;
            return { ok: true, data: f.input.response };
          },
        }),
      ).rejects.toThrow();
      expect(submissions).toBe(0);
      expect(
        await loadPrincipalMutationJournal(f.input.execSql, f.row.scopeId),
      ).not.toBeNull();
      expect(
        await discardUnreadableJournaledPrincipalMutation({
          ...f.input,
          recordId: inspection.recordId,
          acknowledgeUnknownOutcome: true,
        }),
      ).toBe(true);
      expect(
        await loadPrincipalMutationJournal(f.input.execSql, f.row.scopeId),
      ).toBeNull();
      expect(
        await f.input.execSql(
          "SELECT name FROM sqlite_master WHERE name = 'principal_policy_checkpoints'",
        ),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  },
);

test.each(["changed", "expired", "unacknowledged", "readable"] as const)(
  "discard preserves an %s record",
  async (failure) => {
    const f = await fixture();
    try {
      let { recordId } = await inspected(f.input);
      if (failure === "changed")
        await f.input.execSql(
          "UPDATE principal_mutation_journal SET signature = ?",
          ["another-corrupt-record"],
        );
      if (failure === "expired") f.expire();
      if (failure === "readable") {
        const readable = await sealPrincipalMutation(f.input);
        await f.input.execSql(
          "UPDATE principal_mutation_journal SET signature = ?",
          [readable.signature],
        );
        recordId = await principalMutationJournalRecordId(readable);
      }
      const input = {
        ...f.input,
        recordId,
        acknowledgeUnknownOutcome: true as const,
      };
      if (failure === "unacknowledged")
        Reflect.set(input, "acknowledgeUnknownOutcome", false);
      await expect(
        discardUnreadableJournaledPrincipalMutation(input),
      ).rejects.toThrow();
      expect(
        await loadPrincipalMutationJournal(f.input.execSql, f.row.scopeId),
      ).not.toBeNull();
    } finally {
      f.close();
    }
  },
);
