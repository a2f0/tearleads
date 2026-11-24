import type {
  DocumentPeerFrontier,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";

export interface DocumentSyncSubmitFailure {
  readonly code?: string | undefined;
  readonly message: string;
  readonly ok: false;
  /** The refused peers of a `document_sync_peer_owned` refusal. */
  readonly peerFrontiers?: readonly DocumentPeerFrontier[] | undefined;
  readonly report: () => void;
  readonly stalePrincipalHeads?:
    | readonly ReferencedPrincipalStateResponse[]
    | undefined;
  readonly status: number | null;
}
