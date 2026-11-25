import {
  type ApiClient,
  type LoginSecondFactor,
  TwoFactorLoginError,
} from "@tearleads/api-client";
import {
  requireUserIdentityAvailable,
  type SessionIdentityAcknowledgments,
} from "./sessionIdentityTrust";
import { sessionLifetime } from "./sessionLifetime";
import {
  authenticateUnlessRefused,
  refuseSessionLogin,
} from "./sessionLoginRefusal";
import { commitSessionRootAcknowledgment } from "./sessionRootAuthority";
import type {
  Session,
  SessionContext,
  SessionDependencies,
  SessionTwoFactorCode,
} from "./sessionTypes";

/** One sign-in: a fresh login, or the silent renewal of an expired session. */
interface SignIn {
  readonly challengeHex?: string | undefined;
  readonly renewal: boolean;
  /** A typed second factor; renewal never has one. */
  readonly twoFactor?: SessionTwoFactorCode | undefined;
}

export async function authenticateSession(
  dependencies: SessionDependencies,
  session: Session & {
    commitContext(
      context: SessionContext,
      kind: "renewal" | "boundary",
      verifiedTicket: string,
    ): void;
    clearAuthentication(renewal: boolean): void;
  },
  acknowledgments: SessionIdentityAcknowledgments,
  signIn: SignIn,
): Promise<boolean> {
  const attempt = sessionLifetime(session).authentication.start(signIn.renewal);
  try {
    return (
      attempt.current() &&
      (await runAuthentication(
        dependencies,
        session,
        acknowledgments,
        signIn,
        attempt.current,
      ))
    );
  } finally {
    attempt.finish();
  }
}

/** A typed code wins; otherwise a remembered device's token, if any. */
function loginSecondFactor(
  signIn: SignIn,
  deviceToken: string | null,
): LoginSecondFactor {
  if (signIn.twoFactor) return { twoFactor: { ...signIn.twoFactor } };
  return deviceToken ? { twoFactorDeviceToken: deviceToken } : {};
}

/** The server no longer honors this device's token; stop sending it. */
function forgetRefusedDeviceToken(
  session: Session,
  sent: LoginSecondFactor,
  error: unknown,
): void {
  if (
    sent.twoFactorDeviceToken &&
    error instanceof TwoFactorLoginError &&
    error.code === "two_factor_required" &&
    session.snapshot.twoFactorDeviceToken === sent.twoFactorDeviceToken
  )
    session.setContext({ twoFactorDeviceToken: null });
}

/**
 * Sends the sign-in. A refusal that ends the session (a suspension, or a
 * second factor silent renewal cannot give) clears the session it started
 * from, unless another sign-in replaced that session meanwhile.
 */
function requestSignIn(
  api: ApiClient,
  session: Parameters<typeof authenticateSession>[1],
  input: {
    readonly fingerprint: string;
    readonly isCurrent: () => boolean;
    readonly privateKey: Uint8Array;
    readonly signIn: SignIn;
    readonly snapshotAtStart: Session["snapshot"];
  },
) {
  const { isCurrent, signIn, snapshotAtStart } = input;
  const secondFactor = loginSecondFactor(
    signIn,
    snapshotAtStart.twoFactorDeviceToken,
  );
  return authenticate(
    api,
    { fingerprint: input.fingerprint, privateKey: input.privateKey },
    { challengeHex: signIn.challengeHex, secondFactor },
    (error) => {
      if (!isCurrent()) return;
      forgetRefusedDeviceToken(session, secondFactor, error);
      if (session.authToken === snapshotAtStart.authToken)
        session.clearAuthentication(signIn.renewal);
    },
  );
}

async function runAuthentication(
  dependencies: SessionDependencies,
  session: Parameters<typeof authenticateSession>[1],
  acknowledgments: SessionIdentityAcknowledgments,
  signIn: SignIn,
  isCurrent: () => boolean,
): Promise<boolean> {
  const { challengeHex, renewal } = signIn;
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
  const authentication = await requestSignIn(dependencies.api, session, {
    fingerprint,
    isCurrent,
    privateKey: signingKeyPair.signingPrivateKey,
    signIn,
    snapshotAtStart,
  });

  const identityCurrent = () =>
    isCurrent() && dependencies.identity.snapshot === identitySnapshot;
  if (!identityCurrent()) {
    return false;
  }

  if (!authentication) {
    session.clearAuthentication(renewal);
    dependencies.log("Authentication failed");
    return false;
  }

  try {
    acknowledgments.assertMatches(authentication.userId, fingerprint);
    if (renewal && authentication.userId !== snapshotAtStart.userId) {
      session.clearAuthentication(renewal);
      return false;
    }
    await pinLocalUserIdentity(
      authentication.userId,
      {
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        signingKeyFingerprint: fingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      },
      () => assertSignInCurrent(identityCurrent),
    );
    if (!identityCurrent()) return false;
    acknowledgments.remember(authentication.userId, fingerprint);
  } catch (error) {
    // This client never uses the issued session, so revoke it rather than
    // leave it valid until expiry.
    await revokeRefusedSession(dependencies.api, authentication.token);
    if (!isCurrent()) return false;
    return refuseSessionLogin(error, authentication.userId, {
      clear: () => session.clearAuthentication(renewal),
      report: dependencies.reportSecurityIncident,
    });
  }
  // A changed root for this identity+org is refused before the token is
  // usable. Decision and commit are one synchronous step against the live
  // snapshot (no await in between); the refusal clears the prior session in
  // that same step and then reports its own incident.
  await commitSessionRootAcknowledgment({
    context: authenticatedSessionContext(session, authentication, renewal),
    onRefused: () => {
      if (session.snapshot === snapshotAtStart)
        session.clearAuthentication(renewal);
    },
    reporter: dependencies.reportSecurityIncident,
    root: authentication,
    session: {
      snapshot: session.snapshot,
      setContext: (context) =>
        session.commitContext(
          context,
          renewal ? "renewal" : "boundary",
          authentication.wsTicket,
        ),
    },
    signingFingerprint: fingerprint,
  });
  dependencies.log("Authentication successful");
  return true;
}

function authenticatedSessionContext(
  session: Session,
  authentication: NonNullable<Awaited<ReturnType<typeof authenticate>>>,
  renewal: boolean,
): SessionContext {
  // An independently selected organization survives renewal. A selection
  // following the server default follows a change to that default.
  const { organizationId: serverDefault } = authentication;
  const selected = session.organizationId;
  return {
    authToken: authentication.token,
    defaultOrganizationId: serverDefault,
    isAuthenticated: true,
    isRoot: authentication.isRoot,
    organizationId:
      renewal && selected && selected !== session.defaultOrganizationId
        ? selected
        : serverDefault,
    ...(authentication.twoFactorDeviceToken
      ? { twoFactorDeviceToken: authentication.twoFactorDeviceToken }
      : {}),
    userId: authentication.userId,
  };
}

async function revokeRefusedSession(api: ApiClient, token: string) {
  try {
    await api.logout(token);
  } catch {
    // Best effort: an unrevoked session still expires on its own.
  }
}

function assertSignInCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error("Sign-in attempt was superseded");
}

function authenticate(
  api: ApiClient,
  key: { readonly fingerprint: string; readonly privateKey: Uint8Array },
  request: {
    readonly challengeHex: string | undefined;
    readonly secondFactor: LoginSecondFactor;
  },
  clear: (error: unknown) => void,
) {
  const { fingerprint, privateKey } = key;
  const { challengeHex, secondFactor } = request;
  return authenticateUnlessRefused(
    () =>
      challengeHex
        ? api.authenticateWithChallenge(
            fingerprint,
            privateKey,
            challengeHex,
            secondFactor,
          )
        : api.authenticate(fingerprint, privateKey, secondFactor),
    clear,
  );
}
