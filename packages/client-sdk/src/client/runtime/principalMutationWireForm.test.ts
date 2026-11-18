import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { sameEpochAdd } from "../../../test/helpers/workflows/sameEpochGroupAdd";
import { PrincipalPolicyBundleRepository } from "../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import type { AuthoredPrincipalMutation } from "../../data/principals/principalMutationJournal";
import { sendWithHeldEnvelopeChanges } from "./principalMutationWireForm";

function refusal(status: number): RequestResult<string> {
  return {
    kind: "http",
    message: "refused",
    method: "PUT",
    ok: false,
    path: "/principals/organization/policy",
    report: () => {},
    status,
    statusText: "Refused",
  };
}

/** A same-epoch leg whose predecessor the device holds. */
async function heldSuccessor() {
  const f = await sameEpochAdd();
  const sqlite = await createTestExecSql("principal-wire-form");
  await new PrincipalPolicyBundleRepository(
    sqlite.execSql,
  ).savePrincipalPolicyBundle(f.predecessor, f.organizationId);
  const saved: AuthoredPrincipalMutation = {
    kind: "organization",
    groupId: null,
    request: f.successor,
  };
  return { saved, sqlite };
}

function byReference(mutation: AuthoredPrincipalMutation): boolean {
  return (
    mutation.kind === "organization" &&
    mutation.request.memberEnvelopeChanges !== undefined
  );
}

test("an API that refuses the changes form gets the saved request in full", async () => {
  const { saved, sqlite } = await heldSuccessor();
  const sent: AuthoredPrincipalMutation[] = [];
  try {
    const result = await sendWithHeldEnvelopeChanges({
      execSql: sqlite.execSql,
      saved,
      send: async (mutation) => {
        sent.push(mutation);
        return byReference(mutation)
          ? refusal(400)
          : { ok: true as const, data: "committed" };
      },
      signal: undefined,
      stillCurrent: () => true,
    });
    expect(result).toEqual({ ok: true, data: "committed" });
    expect(sent.map(byReference)).toEqual([true, false]);
    expect(sent[1]).toBe(saved);
  } finally {
    sqlite.close();
  }
});

test("a refusal of the full form is not resent", async () => {
  const { saved, sqlite } = await heldSuccessor();
  const sent: AuthoredPrincipalMutation[] = [];
  try {
    await sendWithHeldEnvelopeChanges({
      execSql: sqlite.execSql,
      saved,
      send: async (mutation) => {
        sent.push(mutation);
        return refusal(400);
      },
      signal: undefined,
      stillCurrent: () => true,
    });
    expect(sent.map(byReference)).toEqual([true, false]);
  } finally {
    sqlite.close();
  }
});

test("a stalled or cancelled cache read sends the saved request in full", async () => {
  const { saved, sqlite } = await heldSuccessor();
  const stalled = (async () =>
    new Promise<never>(() => {})) as unknown as typeof sqlite.execSql;
  try {
    for (const cancel of [false, true]) {
      const controller = new AbortController();
      const sent: AuthoredPrincipalMutation[] = [];
      const started = Date.now();
      const sending = sendWithHeldEnvelopeChanges({
        execSql: stalled,
        saved,
        send: async (mutation) => {
          sent.push(mutation);
          return { ok: true as const, data: "committed" };
        },
        signal: controller.signal,
        stillCurrent: () => true,
      });
      if (cancel) controller.abort();
      await sending;
      expect(sent).toEqual([saved]);
      expect(Date.now() - started).toBeLessThan(cancel ? 500 : 3_000);
    }
  } finally {
    sqlite.close();
  }
});
