import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";

export interface DocumentSyncSubmitFailure {
  readonly code?: string | undefined;
  readonly message: string;
  readonly ok: false;
  readonly report: () => void;
  readonly stalePrincipalHeads?:
    | readonly ReferencedPrincipalStateResponse[]
    | undefined;
  readonly status: number | null;
}
