import { reportAndRethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";

/**
 * A server answering this identity with another account, or an identity
 * whose durable pin no longer matches, is evidence, not a login failure: the
 * session is cleared, the keying error is recorded, and the error propagates.
 */
export async function refuseSessionLogin(
  error: unknown,
  userId: string,
  session: {
    readonly clear: () => void;
    readonly report: SecurityIncidentReporter | undefined;
  },
): Promise<never> {
  session.clear();
  await reportAndRethrowKeyingVerificationError(error, session.report, {
    objectId: userId,
    objectKind: "user",
    operation: "session.login",
  });
  throw error;
}
