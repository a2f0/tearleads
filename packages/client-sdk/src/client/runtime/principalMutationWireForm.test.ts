import { expect, test } from "bun:test";
import type { RequestResult } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { sameEpochAdd } from "../../../test/helpers/workflows/sameEpochGroupAdd";
import { PrincipalPolicyBundleRepository } from "../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import type { AuthoredPrincipalMutation } from "../../data/principals/principalMutationJournal";
import { sendWithHeldEnvelopeChanges } from "./principalMutationWireForm";

/** The refusal an API that does not read envelope changes gives. */
const UNREAD =
  "Principal state memberEnvelopesRoot does not match member envelopes";

let reports = 0;

function refusal(status: number, message = UNREAD): RequestResult<string> {
  return {
    kind: "http",
    message,
    method: "PUT",
    ok: false,
    path: "/principals/organization/policy",
    report: () => {
      reports += 1;
    },
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

test("other refusals of the changes form stand, and the full form is never resent", async () => {
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
    // A stale-state refusal is an answer, not a format problem.
    sent.length = 0;
    const stale = await sendWithHeldEnvelopeChanges({
      execSql: sqlite.execSql,
      saved,
      send: async (mutation) => {
        sent.push(mutation);
        return refusal(409, "Principal policy state is stale");
      },
      signal: undefined,
      stillCurrent: () => true,
    });
    expect(stale.ok).toBe(false);
    expect(sent.map(byReference)).toEqual([true]);
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

test("a session switch before the refusal arrives sends nothing more", async () => {
  const { saved, sqlite } = await heldSuccessor();
  let current = true;
  const sent: AuthoredPrincipalMutation[] = [];
  try {
    await expect(
      sendWithHeldEnvelopeChanges({
        execSql: sqlite.execSql,
        saved,
        send: async (mutation) => {
          sent.push(mutation);
          current = false;
          return refusal(400);
        },
        signal: undefined,
        stillCurrent: () => current,
      }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(1);
  } finally {
    sqlite.close();
  }
});

test("the saved request goes out verbatim, in its sealed envelope order", async () => {
  const { saved, sqlite } = await heldSuccessor();
  if (saved.kind !== "organization") throw new Error("expected the leg");
  // An entry sealed before envelope order was canonical: recovery and the
  // fallback must send its bytes as they were first sent.
  const reversed: AuthoredPrincipalMutation = {
    ...saved,
    request: {
      ...saved.request,
      memberEnvelopes: [...saved.request.memberEnvelopes].reverse(),
    },
  };
  const sent: AuthoredPrincipalMutation[] = [];
  try {
    await sendWithHeldEnvelopeChanges({
      // No held predecessor: the full list goes out.
      execSql: (async () => {
        throw new Error("no cache");
      }) as unknown as typeof sqlite.execSql,
      saved: reversed,
      send: async (mutation) => {
        sent.push(mutation);
        return { ok: true as const, data: "committed" };
      },
      signal: undefined,
      stillCurrent: () => true,
    });
    expect(sent).toEqual([reversed]);
    expect(sent[0]).toBe(reversed);
  } finally {
    sqlite.close();
  }
});

test("the first attempt's refusal is reported only when it is the outcome", async () => {
  const { saved, sqlite } = await heldSuccessor();
  try {
    for (const [first, expected] of [
      // The format refusal is followed by the full form, which succeeds.
      [refusal(400), 0],
      // Any other refusal is the outcome, reported once.
      [refusal(409, "stale"), 1],
    ] as const) {
      reports = 0;
      let attempt = 0;
      await sendWithHeldEnvelopeChanges({
        execSql: sqlite.execSql,
        reportErrors: true,
        saved,
        send: async () => {
          attempt += 1;
          return attempt === 1 ? first : { ok: true as const, data: "ok" };
        },
        signal: undefined,
        stillCurrent: () => true,
      });
      expect(reports).toBe(expected);
    }
  } finally {
    sqlite.close();
  }
});

test("a first refusal is not reported after a session switch or cancellation", async () => {
  const { saved, sqlite } = await heldSuccessor();
  try {
    for (const interrupt of ["switch", "cancel"] as const) {
      reports = 0;
      let current = true;
      const controller = new AbortController();
      await sendWithHeldEnvelopeChanges({
        execSql: sqlite.execSql,
        reportErrors: true,
        saved,
        send: async () => {
          if (interrupt === "switch") current = false;
          else controller.abort();
          return refusal(409, "stale");
        },
        signal: controller.signal,
        stillCurrent: () => current,
      });
      expect(reports).toBe(0);
    }
  } finally {
    sqlite.close();
  }
});
