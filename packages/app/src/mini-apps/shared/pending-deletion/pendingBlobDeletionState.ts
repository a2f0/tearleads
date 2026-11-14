import type {
  PendingBlobDeletion,
  PendingBlobDeletionsPage,
  RootRequestOutcome,
} from "@tearleads/client-sdk";

export type PendingBlobDeletionLoader = (
  cursor: string | null,
) => Promise<RootRequestOutcome<PendingBlobDeletionsPage>>;

type Rows = ReadonlyArray<PendingBlobDeletion>;
export type PendingBlobDeletionState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading";
      readonly requestId: number;
      readonly request: PendingBlobDeletionLoader;
      readonly cursor: string | null;
      readonly rows: Rows;
    }
  | {
      readonly status: "ready";
      readonly rows: Rows;
      readonly nextAfterId: string | null;
    }
  | { readonly status: "failed"; readonly message: string };

type Event =
  | {
      readonly type: "load";
      readonly requestId: number;
      readonly request: PendingBlobDeletionLoader;
      readonly cursor: string | null;
    }
  | {
      readonly type: "resolved";
      readonly requestId: number;
      readonly page: PendingBlobDeletionsPage;
    }
  | {
      readonly type: "failed";
      readonly requestId: number;
      readonly message: string;
    };

export function transitionPendingBlobDeletion(
  state: PendingBlobDeletionState,
  event: Event,
): PendingBlobDeletionState {
  if (event.type === "load") {
    if (event.cursor !== null && state.status !== "ready") return state;
    return {
      status: "loading",
      requestId: event.requestId,
      request: event.request,
      cursor: event.cursor,
      rows: event.cursor !== null && state.status === "ready" ? state.rows : [],
    };
  }
  if (state.status !== "loading" || state.requestId !== event.requestId) {
    return state;
  }
  if (event.type === "failed") {
    // Never keep previously authorized rows after an access failure.
    return { status: "failed", message: event.message };
  }
  return {
    status: "ready",
    rows: [...state.rows, ...event.page.blobs],
    nextAfterId: event.page.nextAfterId,
  };
}
