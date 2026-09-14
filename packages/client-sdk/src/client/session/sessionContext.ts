import { restoreSessionRoots } from "./sessionRootAuthority";
import type { SessionContext, SessionSnapshot } from "./sessionTypes";

export function mergeSessionContext(
  previous: SessionSnapshot,
  context: SessionContext,
  signingFingerprint: string | null,
): SessionSnapshot {
  const rootAcknowledgments = restoreSessionRoots(
    previous.rootAcknowledgments,
    context.rootAcknowledgments,
    signingFingerprint,
    "userId" in context ? (context.userId ?? null) : previous.userId,
  );
  return {
    rootAcknowledgments,
    authToken:
      "authToken" in context ? (context.authToken ?? null) : previous.authToken,
    containerId:
      "containerId" in context
        ? (context.containerId ?? null)
        : previous.containerId,
    defaultOrganizationId:
      "defaultOrganizationId" in context
        ? (context.defaultOrganizationId ?? null)
        : previous.defaultOrganizationId,
    isAuthenticated:
      "isAuthenticated" in context
        ? (context.isAuthenticated ?? false)
        : previous.isAuthenticated,
    isRoot: "isRoot" in context ? (context.isRoot ?? false) : previous.isRoot,
    organizationId:
      "organizationId" in context
        ? (context.organizationId ?? null)
        : previous.organizationId,
    userId: "userId" in context ? (context.userId ?? null) : previous.userId,
  };
}

export function sessionSnapshotsEqual(
  previous: SessionSnapshot,
  next: SessionSnapshot,
): boolean {
  return (
    previous.rootAcknowledgments === next.rootAcknowledgments &&
    previous.authToken === next.authToken &&
    previous.containerId === next.containerId &&
    previous.defaultOrganizationId === next.defaultOrganizationId &&
    previous.isAuthenticated === next.isAuthenticated &&
    previous.isRoot === next.isRoot &&
    previous.organizationId === next.organizationId &&
    previous.userId === next.userId
  );
}

export function emptySessionSnapshot(): SessionSnapshot {
  return {
    rootAcknowledgments: [],
    authToken: null,
    containerId: null,
    defaultOrganizationId: null,
    isAuthenticated: false,
    isRoot: false,
    organizationId: null,
    userId: null,
  };
}
