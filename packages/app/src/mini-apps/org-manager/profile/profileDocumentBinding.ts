import type { Documents } from "@tearleads/client-sdk";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { resolveProfileDocumentIdentity } from "../../../stores/org-manager/profileDocumentIdentity";
import {
  isProfileDocumentScopeCurrent,
  useProfileDocumentScope,
} from "../../../stores/org-manager/profileDocumentScope";
import { createBoundedRetrySchedule } from "../hooks/boundedRetry";
import {
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
  if (!stillCurrent() || identity.status !== "existing")
    return { status: "unavailable" };
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

  useEffect(() => {
    let active = true;
    const stillCurrent = () =>
      active &&
      committedRequest.current === request &&
      isProfileDocumentScopeCurrent(request.scope);
    const unavailable = () => {
      if (stillCurrent()) dispatch({ type: "unavailable", request });
    };
    const retry = createBoundedRetrySchedule(attempt);
    dispatch({ type: "started", request });

    async function resolve() {
      const result = await resolveBinding(
        request,
        request.scope.documents,
        stillCurrent,
      );
      if (!stillCurrent()) return;
      if (result.status === "retry") {
        if (request.retryContainer && !retry.exhausted) retry.scheduleNext();
        else unavailable();
      } else if (result.status === "ready") {
        dispatch({ type: "resolved", request, value: result.value });
      } else {
        unavailable();
      }
    }
    function attempt() {
      void resolve().catch(unavailable);
    }
    attempt();
    return () => {
      active = false;
      retry.cancel();
    };
  }, [request]);

  // Mask old content during render, before effect cleanup/reset can run.
  return state.request === request ? state : { status: "loading", request };
}
