import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { useDocument } from "../../../stores/documents/DocumentsProvider";
import {
  isProfileDocumentScopeCurrent,
  useProfileDocumentScope,
} from "../../../stores/org-manager/profileDocumentScope";
import { transitionProfileDocumentRequest } from "./profileDocumentRequestMachine";

/** Relink the resolved local record, without turning read access into write. */
export function useProfileDocumentLink({
  documentId,
  profileDocumentId,
  ready,
  relink,
  relinkInput,
}: {
  documentId: string | null;
  profileDocumentId: string | null;
  ready: boolean;
  relink: ReturnType<typeof useDocument>["relink"];
  relinkInput: Parameters<ReturnType<typeof useDocument>["relink"]>[0] | null;
}): { linkFailed: boolean; linkReady: boolean } {
  const scope = useProfileDocumentScope();
  const request = useMemo(
    () => ({
      documentId,
      profileDocumentId,
      ready,
      relink,
      relinkInput,
      scope,
    }),
    [documentId, profileDocumentId, ready, relink, relinkInput, scope],
  );
  const committedRequest = useRef<object | null>(request);
  const [state, dispatch] = useReducer(transitionProfileDocumentRequest<null>, {
    status: "loading",
    request,
  });
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
      isProfileDocumentScopeCurrent(request.scope) &&
      (request.relinkInput?.stillCurrent?.() ?? true);
    dispatch({ type: "started", request });
    if (request.ready) {
      if (
        !request.documentId ||
        !request.relinkInput ||
        request.documentId !== request.profileDocumentId
      ) {
        dispatch({ type: "unavailable", request });
      } else {
        void request
          .relink({ ...request.relinkInput, stillCurrent })
          .then((result) => {
            if (!stillCurrent()) return;
            dispatch(
              result === null
                ? { type: "unavailable", request }
                : { type: "resolved", request, value: null },
            );
          })
          .catch(() => {
            if (stillCurrent()) dispatch({ type: "unavailable", request });
          });
      }
    }
    return () => {
      active = false;
    };
  }, [request]);
  const current = state.request === request;
  return {
    linkFailed: current && state.status === "unavailable",
    linkReady: current && state.status === "ready",
  };
}
