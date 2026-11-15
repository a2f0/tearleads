import type { Documents } from "@tearleads/client-sdk";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { resolveProfileDocumentIdentity } from "../../../stores/org-manager/profileDocumentIdentity";
import {
  isProfileDocumentScopeCurrent,
  type ProfileDocumentScope,
  useProfileDocumentScope,
} from "../../../stores/org-manager/profileDocumentScope";
import { createBoundedRetrySchedule } from "../hooks/boundedRetry";
import {
  type ProfileDocumentDiscoveryEvent,
  type ProfileDocumentDiscoveryState,
  transitionProfileDocumentDiscovery,
} from "./profileDocumentDiscoveryMachine";
import {
  type ProfileDocumentRequestEvent,
  type ProfileDocumentRequestState,
  transitionProfileDocumentRequest,
} from "./profileDocumentRequestMachine";

interface ProfileDocumentBinding {
  readonly containerId: string;
  readonly documentId: string;
  readonly localId: string;
}

type Actions = ReturnType<typeof useOrgManagerActions>;

interface ProfileDocumentBindingInput {
  documentId: string | null;
  ensureContainer: Actions["ensureRosterProfileContainer"];
  ensureDocument?: Actions["ensureOrganizationProfileDocument"] | undefined;
  organizationId: string;
  preferredLocalId: string;
  retryContainer?: boolean | undefined;
}

type ProfileBindingResolution =
  | { status: "ready"; value: ProfileDocumentBinding }
  // No local row holds the target remote id yet; discovery may persist one.
  | { status: "missing"; containerId: string; documentId: string }
  | { status: "unavailable" | "retry" };

async function resolveBinding(
  request: ProfileDocumentBindingInput,
  documents: Documents,
  stillCurrent: () => boolean,
): Promise<ProfileBindingResolution> {
  const targetDocumentId =
    request.documentId ?? (await request.ensureDocument?.(null)) ?? null;
  if (!stillCurrent() || !targetDocumentId) return { status: "unavailable" };
  const container = await request.ensureContainer();
  if (!stillCurrent()) return { status: "unavailable" };
  if (!container?.id) return { status: "retry" };
  const identity = await resolveProfileDocumentIdentity({
    containerId: container.id,
    documentId: targetDocumentId,
    documents,
    preferredLocalId: request.preferredLocalId,
    stillCurrent,
  });
  if (!stillCurrent()) return { status: "unavailable" };
  if (identity.status === "create")
    return {
      status: "missing",
      containerId: container.id,
      documentId: targetDocumentId,
    };
  if (identity.status !== "existing") return { status: "unavailable" };
  if (identity.documentId !== null && identity.documentId !== targetDocumentId)
    return { status: "unavailable" };
  return {
    status: "ready",
    value: {
      containerId: container.id,
      documentId: targetDocumentId,
      localId: identity.localId,
    },
  };
}

interface ProfileBindingRequest extends ProfileDocumentBindingInput {
  readonly scope: ProfileDocumentScope;
}

/** Resolves one request until the returned cleanup runs. A target that is
 * not yet local is retried on discovery; resolution never creates one. */
function startBindingResolution(
  request: ProfileBindingRequest,
  isCommitted: () => boolean,
  dispatch: (
    event: ProfileDocumentRequestEvent<ProfileDocumentBinding>,
  ) => void,
): () => void {
  let active = true;
  const stillCurrent = () =>
    active && isCommitted() && isProfileDocumentScopeCurrent(request.scope);
  const unavailable = () => {
    if (stillCurrent()) dispatch({ type: "unavailable", request });
  };
  const retry = createBoundedRetrySchedule(attempt);
  let discovery: ProfileDocumentDiscoveryState = { status: "idle" };
  const observe = (event: ProfileDocumentDiscoveryEvent) => {
    discovery = transitionProfileDocumentDiscovery(discovery, event);
    if (discovery.status !== "rediscovered" || !stillCurrent()) return;
    dispatch({ type: "started", request });
    attempt();
  };
  // Held for the whole request so a target persisted mid-lookup is not lost.
  const unsubscribe = request.scope.documents.subscribe(
    (document, { placementChanged }) =>
      observe({ type: "persisted", document, placementChanged }),
  );
  const settle = (result: ProfileBindingResolution) => {
    if (result.status === "missing") {
      observe({
        type: "missing",
        containerId: result.containerId,
        documentId: result.documentId,
      });
      if (discovery.status === "awaiting") unavailable();
      return;
    }
    observe({ type: "settled" });
    if (result.status === "ready") {
      dispatch({ type: "resolved", request, value: result.value });
    } else if (
      result.status === "retry" &&
      request.retryContainer &&
      !retry.exhausted
    ) {
      retry.scheduleNext();
    } else {
      unavailable();
    }
  };
  async function resolve() {
    observe({ type: "resolving", documentId: request.documentId });
    const result = await resolveBinding(
      request,
      request.scope.documents,
      stillCurrent,
    );
    if (stillCurrent()) settle(result);
  }
  function attempt() {
    void resolve().catch(() => {
      observe({ type: "settled" });
      unavailable();
    });
  }
  dispatch({ type: "started", request });
  attempt();
  return () => {
    active = false;
    retry.cancel();
    unsubscribe();
  };
}

export function useProfileDocumentBinding({
  documentId,
  ensureContainer,
  ensureDocument,
  organizationId,
  preferredLocalId,
  retryContainer = false,
}: ProfileDocumentBindingInput): ProfileDocumentRequestState<ProfileDocumentBinding> {
  const scope = useProfileDocumentScope();
  // Object identity distinguishes A -> B -> A, even when the final values
  // equal the first request. Only a documents scope change, not every runtime
  // notification, invalidates the bind.
  const request = useMemo(
    () => ({
      documentId,
      ensureContainer,
      ensureDocument,
      organizationId,
      preferredLocalId,
      retryContainer,
      scope,
    }),
    [
      documentId,
      ensureContainer,
      ensureDocument,
      organizationId,
      preferredLocalId,
      retryContainer,
      scope,
    ],
  );
  const committedRequest = useRef<object | null>(request);
  const [state, dispatch] = useReducer(
    transitionProfileDocumentRequest<ProfileDocumentBinding>,
    { status: "loading", request },
  );

  useLayoutEffect(() => {
    committedRequest.current = request;
    return () => {
      if (committedRequest.current === request) committedRequest.current = null;
    };
  }, [request]);

  useEffect(
    () =>
      startBindingResolution(
        request,
        () => committedRequest.current === request,
        dispatch,
      ),
    [request],
  );

  // Mask old content during render, before effect cleanup/reset can run.
  return state.request === request ? state : { status: "loading", request };
}
