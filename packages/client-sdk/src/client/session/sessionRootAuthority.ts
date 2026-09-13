import type { Session, SessionContext } from "./sessionTypes";

const roots = new WeakMap<Session, Map<string, string | null>>();

/** Session acknowledgements are independent of the local root awaiting reconciliation. */
export function acknowledgeSessionRoot(
  session: Session,
  input: {
    userId: string;
    organizationId: string;
    rootContainerId: string | null;
  },
): void {
  const known = roots.get(session) ?? new Map<string, string | null>();
  known.set(
    JSON.stringify([input.userId, input.organizationId]),
    input.rootContainerId,
  );
  roots.set(session, known);
}

export function acknowledgedSessionRoot(session: Session): string | null {
  if (!session.userId || !session.organizationId) return null;
  return (
    roots
      .get(session)
      ?.get(JSON.stringify([session.userId, session.organizationId])) ?? null
  );
}

export function acknowledgeSessionContextRoot(
  session: Session,
  context: SessionContext,
): void {
  const userId = context.userId ?? session.userId;
  if (userId && context.organizationId && "containerId" in context) {
    acknowledgeSessionRoot(session, {
      userId,
      organizationId: context.organizationId,
      rootContainerId: context.containerId ?? null,
    });
  }
}
