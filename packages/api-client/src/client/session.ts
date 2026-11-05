import { sign } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  challengeOperation,
  destroySessionOperation,
  getHealthOperation,
  listSessionsOperation,
  logoutOperation,
  registerOperation,
  verifyOperation,
} from "@tearleads/validators/operation";
import type { RegistrationRequest } from "@tearleads/validators/request";
import type { VerifySuccessResponse } from "@tearleads/validators/response";
import { verifiedLogin } from "../accountSuspension";
import type { ApiNetworkError } from "../networkFailure";
import { bindPrototypeMethods } from "../requestInternals";
import {
  destroySession as authDestroySession,
  listSessions as authListSessions,
  logout as authLogout,
} from "../routes/auth/session";
import type { HttpMethod } from "../types";
import type { VerifiedManifestCitations } from "../verifiedManifestCitations";
import { WebSocketTickets } from "../webSocketTickets";
import type { ApiClientContext } from "./apiClientContext";
import type { ApiClientSelf } from "./apiClientSelf";

type ExpiredHandler = () => boolean | Promise<boolean>;
type PaymentRequiredHandler = (organizationId: string | null) => void;

/** Connection hooks, the session token, registration, and login. */
export class SessionArea {
  private readonly webSocketTickets: WebSocketTickets;

  constructor(
    private readonly context: ApiClientContext,
    private readonly self: Pick<
      ApiClientSelf,
      "authenticateWithChallenge" | "getAuthToken"
    >,
  ) {
    bindPrototypeMethods(this, SessionArea.prototype);
    this.webSocketTickets = new WebSocketTickets(context.transport, () =>
      self.getAuthToken(),
    );
  }

  setOnError(handler: ((message: string) => void) | null): void {
    this.context.runtime.setOnError(handler);
  }

  setOnNetworkError(handler: (() => void) | null): void {
    this.context.runtime.setOnNetworkError(handler);
  }

  setOnNetworkSuccess(handler: (() => void) | null): void {
    this.context.runtime.setOnNetworkSuccess(handler);
  }

  /** Every fetch that threw without a response, except plain cancellations. */
  setOnNetworkFailure(handler: ((e: ApiNetworkError) => void) | null): void {
    this.context.runtime.setOnNetworkFailure(handler);
  }

  setOnApiVersion(handler: ((version: number) => void) | null): void {
    this.context.runtime.setOnApiVersion(handler);
  }

  setOnSessionExpired(handler: ExpiredHandler | null): void {
    this.context.runtime.setOnSessionExpired(handler);
  }

  setOnPaymentRequired(handler: PaymentRequiredHandler | null): void {
    this.context.runtime.setOnPaymentRequired(handler);
  }

  /** Verified bundles to cite on projection reads, scoped by their owner. */
  setVerifiedManifestCitations(source: VerifiedManifestCitations | null): void {
    this.context.verifiedManifestCitations = source;
  }

  setAuthToken(token: string | null): void {
    if (this.context.runtime.setAuthToken(token)) {
      this.context.clearAuthScopedCaches();
    }
  }

  getAuthToken(): string | null {
    return this.context.runtime.getAuthToken();
  }

  getRequestFailure(input: { method: HttpMethod; path: string }) {
    return this.context.runtime.getRequestFailure(input);
  }

  requestWebSocketTicket(): Promise<string | null> {
    return this.webSocketTickets.next();
  }

  getHealth() {
    return this.context.transport.request(getHealthOperation, { params: {} });
  }

  registerUser(
    userId: string,
    organizationId: string,
    rootContainerId: string,
    signingPublicKey: Uint8Array,
    encapsulationPublicKey: Uint8Array,
    initialAdminGroup: RegistrationRequest["initialAdminGroup"],
    initialMemberGroup: RegistrationRequest["initialMemberGroup"],
    initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"],
    initialRootContainer: RegistrationRequest["initialRootContainer"],
    initialRootMetadataDocument: RegistrationRequest["initialRootMetadataDocument"],
    initialRosterProfileContainer: RegistrationRequest["initialRosterProfileContainer"],
    initialRosterProfileDocument: RegistrationRequest["initialRosterProfileDocument"],
    initialOrganizationMetadataContainer: RegistrationRequest["initialOrganizationMetadataContainer"],
    initialOrganizationProfileDocument?: RegistrationRequest["initialOrganizationProfileDocument"],
    initialSystemContainers?: RegistrationRequest["initialSystemContainers"],
  ) {
    return this.context.transport.request(registerOperation, {
      body: {
        userId,
        organizationId,
        rootContainerId,
        signingPublicKey: bytesToBase64(signingPublicKey),
        encapsulationPublicKey: bytesToBase64(encapsulationPublicKey),
        initialAdminGroup,
        initialMemberGroup,
        initialOrganizationPolicy,
        initialRootContainer,
        initialRootMetadataDocument,
        initialRosterProfileContainer,
        initialRosterProfileDocument,
        initialOrganizationMetadataContainer,
        initialOrganizationProfileDocument,
        initialSystemContainers,
      },
      params: {},
    });
  }

  async authenticate(fingerprint: string, secretKey: Uint8Array) {
    const challenge = await this.context.transport.request(
      challengeOperation,
      { body: { fingerprint }, params: {} },
      { retryOnSessionExpired: false },
    );
    if (!challenge) return null;

    return this.self.authenticateWithChallenge(
      fingerprint,
      secretKey,
      challenge.challenge,
    );
  }

  async authenticateWithChallenge(
    fingerprint: string,
    secretKey: Uint8Array,
    challengeHex: string,
  ): Promise<VerifySuccessResponse | null> {
    const signed = sign(
      this.context.runtime.authChallengeBytes(challengeHex, fingerprint),
      secretKey,
    );
    const response = verifiedLogin(
      await this.context.transport.requestResult(
        verifyOperation,
        {
          body: { fingerprint, signature: bytesToBase64(signed) },
          params: {},
        },
        { retryOnSessionExpired: false },
      ),
    );
    if (!response?.authenticated) return null;
    this.webSocketTickets.rememberLogin(response);
    return response;
  }

  listSessions() {
    return this.context.send(
      authListSessions,
      authListSessions.path,
      listSessionsOperation,
    );
  }

  destroySession(sessionId: string) {
    return this.context.send(
      authDestroySession,
      authDestroySession.path(sessionId),
      destroySessionOperation,
    );
  }

  logout() {
    return this.context.send(
      authLogout,
      authLogout.path,
      logoutOperation,
      undefined,
      {
        retryOnSessionExpired: false,
      },
    );
  }
}
