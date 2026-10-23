import type { RootIdentitySummary } from "../../workflows/root/identitySummary";
import {
  liftRootIdentitySuspension,
  suspendRootIdentity,
} from "../../workflows/root/identitySuspension";
import { createDatabaseWorkflowService } from "../databaseWorkflowService";
import type { ApiServiceRuntime } from "../runtime";
import { RootIdentityError } from "./identities";

/** The session store calls a suspension sweeps an identity's sessions with. */
export interface IdentitySessionStore {
  readonly destroyUserSession: (input: {
    sessionId: string;
    userId: string;
  }) => Promise<boolean>;
  readonly listUserSessions: (input: {
    currentToken: string;
    userId: string;
  }) => Promise<readonly { readonly id: string }[]>;
}

const applySuspension = createDatabaseWorkflowService(suspendRootIdentity);
const removeSuspension = createDatabaseWorkflowService(
  liftRootIdentitySuspension,
);

/**
 * Suspends the identity, then revokes every live session it holds. The flag
 * commits before the sweep, and sign-in re-reads it after issuing a session,
 * so a login racing the suspension either sees the flag or leaves a session
 * the sweep finds. The sweep runs even when the identity was already
 * suspended, so repeating the call retries one that failed partway.
 */
export async function suspendIdentity(
  runtime: ApiServiceRuntime,
  sessions: IdentitySessionStore,
  userId: string,
): Promise<RootIdentitySummary> {
  const result = await applySuspension(runtime, { now: new Date(), userId });
  if (result.kind === "missing") {
    throw new RootIdentityError("User not found", 404);
  }
  if (result.kind === "root") {
    throw new RootIdentityError(
      "Root identities cannot be suspended; revoke root with the API CLI first",
      409,
    );
  }

  const live = await sessions.listUserSessions({ currentToken: "", userId });
  await Promise.all(
    live.map((session) =>
      sessions.destroyUserSession({ sessionId: session.id, userId }),
    ),
  );
  return result.identity;
}

export async function liftIdentitySuspension(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<RootIdentitySummary> {
  const identity = await removeSuspension(runtime, userId);
  if (!identity) {
    throw new RootIdentityError("User not found", 404);
  }
  return identity;
}
