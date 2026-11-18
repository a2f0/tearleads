import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import {
  readKeyingCanonicalJson,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  advanceGroupHead,
  byReference,
  commit,
  groupWithSameEpochAdd,
  resend,
} from "../../../test/helpers/memberEnvelopeReferenceFixture";
import { principalPolicyOutcomeHashes } from "../../workflows/principals/principalPolicyOutcomeHash";

test("a retry in the other form replays its receipt after the head moves on", async () => {
  for (const firstByReference of [true, false]) {
    const f = await groupWithSameEpochAdd();
    const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
    // The full list in an order the rebuild does not produce.
    const unsorted = {
      ...full,
      memberEnvelopes: [...full.memberEnvelopes].sort((left, right) =>
        left.userId < right.userId ? 1 : -1,
      ),
    };
    const compact = byReference(full, [f.added]);
    const { body, response } = await commit(
      f,
      firstByReference ? compact : unsorted,
    );
    expect(response.status).toBe(200);
    const original = await response.json();
    await advanceGroupHead(f);
    invariant(body, "expected the sent request");
    const sent: CommitOrganizationGroupPolicyRequest = body;
    const retried = await resend(f, {
      ...sent,
      groupPolicy: firstByReference ? unsorted : compact,
    });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(original);
  }
});

test("a full retry still finds a receipt keyed by its as-sent order", async () => {
  const f = await groupWithSameEpochAdd();
  const full = await f.sign(f.current.keyEpoch, [...f.retained, f.added]);
  const unsorted = {
    ...full,
    memberEnvelopes: [...full.memberEnvelopes].sort((left, right) =>
      left.userId < right.userId ? 1 : -1,
    ),
  };
  const { body, response } = await commit(f, unsorted);
  expect(response.status).toBe(200);
  const original = await response.json();
  invariant(body, "expected the sent request");
  const sent: CommitOrganizationGroupPolicyRequest = body;
  // Re-key the stored receipt as one written before the order was canonical:
  // the hash of the request exactly as sent.
  const parts = [
    "tearleads.principal-policy.commit.v1",
    f.organizationId,
    f.groupId,
    f.owner.userId,
    sent,
  ];
  const legacyHash = createHash("sha256")
    .update(
      serializeKeyingCanonicalJson(
        readKeyingCanonicalJson(JSON.parse(JSON.stringify(parts)), "request"),
      ),
    )
    .digest("hex");
  const { requestHash } = principalPolicyOutcomeHashes(parts);
  expect(legacyHash).not.toBe(requestHash);
  await db
    .update(principalPolicyCommits)
    .set({ requestHash: legacyHash })
    .where(eq(principalPolicyCommits.requestHash, requestHash));
  await advanceGroupHead(f);
  const retried = await resend(f, sent);
  expect(retried.status).toBe(200);
  expect(await retried.json()).toEqual(original);
});
