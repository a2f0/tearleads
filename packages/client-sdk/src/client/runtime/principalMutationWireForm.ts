import type { RequestResult } from "@tearleads/api-client";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { withHeldMemberEnvelopeChanges } from "../../data/principals/memberEnvelopeReferences";
import type { AuthoredPrincipalMutation } from "../../data/principals/principalMutationJournal";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

/** The cache read may not hold the journal lane: past this, send in full. */
const HELD_PREDECESSOR_READ_MS = 1_000;

/** The wire form, or the saved form if the read stalls or is cancelled. */
async function boundedWireForm(
  execSql: ExecSql,
  saved: AuthoredPrincipalMutation,
  signal: AbortSignal | undefined,
): Promise<AuthoredPrincipalMutation> {
  const fallback = Promise.withResolvers<AuthoredPrincipalMutation>();
  const timer = setTimeout(
    () => fallback.resolve(saved),
    HELD_PREDECESSOR_READ_MS,
  );
  const onAbort = () => fallback.resolve(saved);
  if (signal?.aborted) onAbort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([
      withHeldMemberEnvelopeChanges(execSql, saved),
      fallback.promise,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * How an API that predates envelope changes refuses one: it reads the empty
 * list as the whole set, whose root then misses the signed one.
 */
const UNREAD_CHANGES_REFUSAL =
  "Principal state memberEnvelopesRoot does not match member envelopes";

function refusedUnreadChanges(result: RequestResult<unknown>): boolean {
  return (
    !result.ok &&
    result.kind === "http" &&
    result.status === 400 &&
    result.message.includes(UNREAD_CHANGES_REFUSAL)
  );
}

/**
 * Sends a newly sealed journaled mutation with its held envelope sets by
 * reference (#2903 P17); recovery always resends the saved full request. The
 * optional cache read is bounded and yields to cancellation, and a switched
 * session or database sends nothing. Only the refusal of an API that does not
 * read envelope changes is resent in full; every other answer stands, so a
 * known refusal is never traded for an unknown outcome.
 */
export async function sendWithHeldEnvelopeChanges<
  Result extends RequestResult<unknown>,
>(input: {
  readonly execSql: ExecSql;
  readonly saved: AuthoredPrincipalMutation;
  readonly send: (mutation: AuthoredPrincipalMutation) => Promise<Result>;
  readonly signal: AbortSignal | undefined;
  readonly stillCurrent: () => boolean;
}): Promise<Result> {
  const { saved } = input;
  const wire = await boundedWireForm(input.execSql, saved, input.signal);
  assertProjectionVerificationCurrent(input.stillCurrent);
  const result = await input.send(wire);
  if (wire === saved || !refusedUnreadChanges(result)) return result;
  assertProjectionVerificationCurrent(input.stillCurrent);
  return input.send(saved);
}
