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
 * Sends a journaled mutation with its held envelope sets by reference
 * (#2903 P17). The optional cache read is bounded and yields to cancellation,
 * a switched session or database sends nothing, and a refused request sent by
 * reference is resent in full once: an API that predates envelope changes
 * reads the empty list as the whole set and refuses it.
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
  const wire = await boundedWireForm(input.execSql, input.saved, input.signal);
  assertProjectionVerificationCurrent(input.stillCurrent);
  const result = await input.send(wire);
  return wire !== input.saved &&
    !result.ok &&
    result.kind === "http" &&
    (result.status === 400 || result.status === 409)
    ? input.send(input.saved)
    : result;
}
