import type { ApiClient } from "@tearleads/api-client";
import {
  requireUserIdentityAvailable,
  type SessionIdentityAcknowledgments,
} from "./sessionIdentityTrust";
import { sessionLifetime } from "./sessionLifetime";
import {
  authenticateUnlessSuspended,
  refuseSessionLogin,
} from "./sessionLoginRefusal";
import { commitSessionRootAcknowledgment } from "./sessionRootAuthority";
import type {
  Session,
  SessionContext,
  SessionDependencies,
} from "./sessionTypes";

export async function authenticateSession(
  dependencies: SessionDependencies,
  session: Session & {
    commitContext(context: SessionContext, kind: "renewal" | "boundary"): void;
  },
  acknowledgments: SessionIdentityAcknowledgments,
  challengeHex: string | undefined,
  renewal: boolean,
): Promise<boolean> {
  const lifetime = sessionLifetime(session);
  const epoch = lifetime.epoch;
  const isCurrent = () => epoch === lifetime.epoch;
  const signingKeyPair = dependencies.identity.requireSigningKeyPair("login");
  const fingerprint =
    (await dependencies.identity.refreshSigningFingerprint()) ?? null;

  if (!isCurrent() || !fingerprint) {
    return false;
  }
  // A refusal below clears the session it is evidence against; a session
  // another login committed meanwhile is not that session and stays.
  const snapshotAtStart = session.snapshot;
  const identitySnapshot = dependencies.identity.snapshot;
  const encapsulationKeyPair = identitySnapshot.encapsulationKeyPair;
  if (
    !encapsulationKeyPair ||
    identitySnapshot.signingKeyPair !== signingKeyPair
  ) {
    return false;
  }
  const pinLocalUserIdentity = requireUserIdentityAvailable(
    dependencies.onUserIdentityAvailable,
    "Login",
  );

  dependencies.log(
    challengeHex ? "Authenticating with challenge..." : "Authenticating...",
  );
  const authentication = await authenticate(
    dependencies.api,
    fingerprint,
    signingKeyPair.signingPrivateKey,
    challengeHex,
    () => {
      if (isCurrent() && session.authToken === snapshotAtStart.authToken)
        session.logout();
    },
  );

  const identityCurrent = () =>
    isCurrent() && dependencies.identity.snapshot === identitySnapshot;
  if (!identityCurrent()) {
    return false;
  }

  if (!authentication) {
    session.logout();
    dependencies.log("Authentication failed");
    return false;
  }

  if (renewal && authentication.userId !== snapshotAtStart.userId) return false;
  try {
    acknowledgments.assertMatches(authentication.userId, fingerprint);
    await pinLocalUserIdentity(authentication.userId, {
      encapsulationPublicKey: encapsulationKeyPair.publicKey,
      signingKeyFingerprint: fingerprint,
      signingPublicKey: signingKeyPair.signingPublicKey,
    });
    if (!identityCurrent()) return false;
    acknowledgments.remember(authentication.userId, fingerprint);
  } catch (error) {
    if (!isCurrent()) return false;
    return refuseSessionLogin(error, authentication.userId, {
      clear: () => session.logout(),
      report: dependencies.reportSecurityIncident,
    });
  }
  // A changed root for this identity+org is refused before the token is
  // usable. Decision and commit are one synchronous step against the live
  // snapshot (no await in between); the refusal clears the prior session in
  // that same step and then reports its own incident.
  await commitSessionRootAcknowledgment({
    context: {
      authToken: authentication.token,
      defaultOrganizationId: authentication.organizationId,
      isAuthenticated: true,
      isRoot: authentication.isRoot,
      organizationId: authentication.organizationId,
      userId: authentication.userId,
    },
    onRefused: () => {
      if (session.snapshot === snapshotAtStart) session.logout();
    },
    reporter: dependencies.reportSecurityIncident,
    root: authentication,
    session: {
      snapshot: session.snapshot,
      setContext: (context) =>
        session.commitContext(context, renewal ? "renewal" : "boundary"),
    },
    signingFingerprint: fingerprint,
  });
  dependencies.log("Authentication successful");
  return true;
}

function authenticate(
  api: ApiClient,
  fingerprint: string,
  privateKey: Uint8Array,
  challengeHex: string | undefined,
  clear: () => void,
) {
  return authenticateUnlessSuspended(
    () =>
      challengeHex
        ? api.authenticateWithChallenge(fingerprint, privateKey, challengeHex)
        : api.authenticate(fingerprint, privateKey),
    clear,
  );
}
