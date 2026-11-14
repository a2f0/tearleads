import type { Documents } from "@tearleads/client-sdk";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { useRuntimeScopedMemo } from "../../../providers/sdk/useRuntimeScopedMemo";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { resolveProfileDocumentIdentity } from "../../../stores/org-manager/profileDocumentIdentity";
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
  const tearleads = useTearleads();
  // Object identity distinguishes A -> B -> A, even when the final values
  // equal the first request. A runtime notification also invalidates the bind.
  const request = useRuntimeScopedMemo(
    () => ({
      documentId,
      ensureContainer,
      ensureDocument,
      organizationId,
      preferredLocalId,
      retryContainer,
      version: tearleads.runtime.version,
    }),
    [
      documentId,
      ensureContainer,
      ensureDocument,
      organizationId,
      preferredLocalId,
      retryContainer,
      tearleads,
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
      tearleads.runtime.version === request.version;
    const unavailable = () => {
      if (stillCurrent()) dispatch({ type: "unavailable", request });
    };
    const retry = createBoundedRetrySchedule(attempt);
    dispatch({ type: "started", request });

    async function resolve() {
      const result = await resolveBinding(
        request,
        tearleads.documents,
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
  }, [request, tearleads]);

  // Mask old content during render, before effect cleanup/reset can run.
  return state.request === request &&
    tearleads.runtime.version === request.version
    ? state
    : { status: "loading", request };
}
