import type { ContainerInterestAuthorizer } from "./containerInterestAuthorization";
import type { RevalidationSchedule } from "./containerInterestRevalidation";
import type { VerifiedContainerInterest } from "./containerInterestTypes";
import type { OrganizationInterestAuthorizer } from "./organizationInterestAuthorization";
import type { GatewaySocket, WsConnection } from "./wsConnection";
import type { WsEventRouter } from "./wsRouting";
import type { WsSessionLiveness } from "./wsSessionLiveness";

/** Server-owned state only: never accept this snapshot from a client. */
export interface GatewaySocketSnapshot {
  readonly proofs: VerifiedContainerInterest[];
  readonly verifiedAt: number;
  readonly nextCheckAt?: number | undefined;
  readonly session: {
    readonly confirmedAt: number;
    readonly nextCheckAt?: number | undefined;
  };
  readonly organization: {
    readonly organizationId: string;
    readonly authorized: boolean;
  } | null;
}

/** Rebuild routing and absolute deadlines without treating wake-up as login. */
export function createGatewayHibernation(input: {
  readonly containerInterest: ContainerInterestAuthorizer;
  readonly liveness: WsSessionLiveness;
  readonly organizationInterest: OrganizationInterestAuthorizer;
  readonly revalidation: RevalidationSchedule<WsConnection>;
  readonly router: WsEventRouter;
}) {
  return {
    snapshot(ws: GatewaySocket): GatewaySocketSnapshot | null {
      if (!input.router.isOpen(ws)) return null;
      return {
        proofs: input.router.snapshotProofs(ws),
        verifiedAt: input.containerInterest.snapshotVerifiedAt(ws),
        nextCheckAt: input.revalidation.nextAt(ws),
        session: input.liveness.snapshot(ws),
        organization: input.organizationInterest.snapshot(ws),
      };
    },
    restore(ws: GatewaySocket, saved: GatewaySocketSnapshot): void {
      input.router.open(ws);
      input.router.applyAuthorizedContainerInterest(
        ws,
        {
          kind: "replace",
          containerIds: saved.proofs.map((proof) => proof.containerId),
        },
        saved.proofs,
      );
      input.organizationInterest.restore(ws, saved.organization);
      input.liveness.open(ws, saved.session);
      input.revalidation.open(ws, saved.nextCheckAt);
      input.containerInterest.open(ws, saved);
    },
  };
}
