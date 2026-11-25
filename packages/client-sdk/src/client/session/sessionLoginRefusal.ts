import {
  AccountSuspendedError,
  TwoFactorLoginError,
} from "@tearleads/api-client";
import {
  reportAndRethrowKeyingVerificationError,
  type SecurityIncidentReporter,
} from "../../data/shared/securityIncidents";

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

/**
 * Runs the sign-in request. A suspended account, or one that needs a second
 * factor silent renewal cannot supply, ends the session it would have
 * renewed: it is cleared, so that session's requests stop renewing, and the
 * error propagates for the host to name or to ask the person for a code.
 */
export async function authenticateUnlessRefused<Authentication>(
  authenticate: () => Promise<Authentication>,
  clear: (error: unknown) => void,
): Promise<Authentication> {
  try {
    return await authenticate();
  } catch (error) {
    if (
      error instanceof AccountSuspendedError ||
      error instanceof TwoFactorLoginError
    ) {
      clear(error);
    }
    throw error;
  }
}
