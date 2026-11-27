import type {
  DocumentPeerFrontier,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";

export interface DocumentSyncSubmitFailure {
  /**
   * With `document_sync_baseline_group_invalid` on a request that commits a
   * staged rotation baseline: what the refusal means for the stage.
   */
  readonly baselineStageCode?: string | undefined;
  readonly code?: string | undefined;
  readonly message: string;
  readonly ok: false;
  /**
   * The refused peers of a `document_sync_peer_owned` or
   * `document_sync_dependency_uncommitted` refusal.
   */
  readonly peerFrontiers?: readonly DocumentPeerFrontier[] | undefined;
  readonly report: () => void;
  readonly stalePrincipalHeads?:
    | readonly ReferencedPrincipalStateResponse[]
    | undefined;
  readonly status: number | null;
}
