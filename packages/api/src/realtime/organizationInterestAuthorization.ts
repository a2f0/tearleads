import { serializeWsServerMessage } from "@tearleads/validators/realtime";
import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { type GatewaySocket, sendSafely } from "./wsConnection";
import {
  type OrganizationInterestDeclaration,
  type OrganizationReadModelAudience,
  readOrganizationReadModelAudienceMessage,
} from "./wsOrganizationRouting";
import type { WsEventRouter } from "./wsRouting";

export type AuthorizeOrganizationAccess = (
  userId: string,
  organizationId: string,
) => Promise<boolean>;

type OrganizationSocket = GatewaySocket;

interface OrganizationAuthorizationState {
  readonly organizationId: string;
  authorization: Promise<boolean> | null;
  authorized: boolean;
}

type PendingOrganizationAuthorization = [
  OrganizationSocket,
  OrganizationAuthorizationState,
];

export class OrganizationInterestAuthorizer {
  private readonly restorationAuthorizations = new Map<
    string,
    Promise<boolean>
  >();
  private readonly states = new Map<
    OrganizationSocket,
    OrganizationAuthorizationState
  >();

  constructor(
    private readonly authorizeOrganizationAccess: AuthorizeOrganizationAccess,
    private readonly authorizationTimeoutMs: number,
    private readonly router: WsEventRouter,
  ) {}

  async apply(
    ws: OrganizationSocket,
    declaration: OrganizationInterestDeclaration,
  ): Promise<void> {
    this.router.applyAuthorizedOrganizationInterest(ws, null);
    if (declaration.organizationId === null) {
      this.states.delete(ws);
      this.sendAcknowledgement(ws, declaration, true);
      return;
    }

    const state: OrganizationAuthorizationState = {
      authorization: null,
      authorized: false,
      organizationId: declaration.organizationId,
    };
    this.states.set(ws, state);
    const authorization = this.authorize(ws.data.userId, state.organizationId);
    state.authorization = authorization;
    const authorized = await authorization;
    if (state.authorization === authorization) {
      state.authorization = null;
    }
    if (this.states.get(ws) !== state) {
      return;
    }
    if (authorized && !this.applyAuthorizedState(ws, state)) {
      return;
    }
    this.sendAcknowledgement(ws, declaration, authorized);
  }

  snapshot(
    ws: OrganizationSocket,
  ): { organizationId: string; authorized: boolean } | null {
    const state = this.states.get(ws);
    return state
      ? { organizationId: state.organizationId, authorized: state.authorized }
      : null;
  }

  restore(
    ws: OrganizationSocket,
    saved: { organizationId: string; authorized: boolean } | null,
  ): void {
    if (!saved) return;
    this.states.set(ws, { ...saved, authorization: null });
    if (saved.authorized)
      this.router.applyAuthorizedOrganizationInterest(ws, saved.organizationId);
  }

  close(ws: OrganizationSocket): void {
    this.states.delete(ws);
  }

  prepareServerEvent(rawMessage: string): Promise<void> | null {
    const audience = readOrganizationReadModelAudienceMessage(rawMessage);
    if (!audience) {
      return null;
    }
    const pendingByUserId = this.collectPending(audience);
    if (pendingByUserId.size === 0) {
      return null;
    }
    return Promise.all(
      [...pendingByUserId].map(([userId, pending]) =>
        this.restorePending(userId, audience.organizationId, pending),
      ),
    ).then(() => undefined);
  }

  private applyAuthorizedState(
    ws: OrganizationSocket,
    state: OrganizationAuthorizationState,
  ): boolean {
    if (this.states.get(ws) !== state) {
      return false;
    }
    state.authorized = true;
    this.router.applyAuthorizedOrganizationInterest(ws, state.organizationId);
    return true;
  }

  private sendAcknowledgement(
    ws: OrganizationSocket,
    declaration: OrganizationInterestDeclaration,
    authorized: boolean,
  ): void {
    sendSafely(
      ws,
      serializeWsServerMessage({
        type: "known_organizations_ack",
        declarationId: declaration.declarationId,
        organizationId: declaration.organizationId,
        authorized,
      }),
    );
  }

  private authorize(userId: string, organizationId: string): Promise<boolean> {
    const authorization = this.authorizeOrganizationAccess(
      userId,
      organizationId,
    ).catch((error) => {
      console.error(
        "Failed to authorize websocket organization interest:",
        error,
      );
      reportBackgroundFailure(error, "websocket.authorize");
      return false;
    });
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (authorized: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(authorized);
      };
      timer = setTimeout(() => finish(false), this.authorizationTimeoutMs);
      // Bun timers hold the process open until unref'd; Workers timers are
      // plain handles with no such method.
      timer.unref?.();
      void authorization.then(finish);
    });
  }

  private collectPending(
    audience: OrganizationReadModelAudience,
  ): Map<string, PendingOrganizationAuthorization[]> {
    const pendingByUserId = new Map<
      string,
      PendingOrganizationAuthorization[]
    >();
    for (const [ws, state] of this.states) {
      if (
        !state.authorized &&
        state.organizationId === audience.organizationId &&
        audience.recipientUserIds.has(ws.data.userId)
      ) {
        const pending = pendingByUserId.get(ws.data.userId) ?? [];
        pending.push([ws, state]);
        pendingByUserId.set(ws.data.userId, pending);
      }
    }
    return pendingByUserId;
  }

  private restorationAuthorization(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const key = `${userId}:${organizationId}`;
    const active = this.restorationAuthorizations.get(key);
    if (active) {
      return active;
    }
    const next = this.authorize(userId, organizationId).finally(() => {
      if (this.restorationAuthorizations.get(key) === next) {
        this.restorationAuthorizations.delete(key);
      }
    });
    this.restorationAuthorizations.set(key, next);
    return next;
  }

  private async restorePending(
    userId: string,
    organizationId: string,
    pending: PendingOrganizationAuthorization[],
  ): Promise<void> {
    await Promise.all(pending.map(([, state]) => state.authorization ?? false));
    const current = pending.filter(
      ([ws, state]) => this.states.get(ws) === state && !state.authorized,
    );
    if (
      current.length === 0 ||
      !(await this.restorationAuthorization(userId, organizationId))
    ) {
      return;
    }
    for (const [ws, state] of current) {
      this.applyAuthorizedState(ws, state);
    }
  }
}
