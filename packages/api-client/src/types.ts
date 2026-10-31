import type {
  DocumentAttributionRangesQuery,
  HttpOperation,
  HttpOperationMethod,
} from "@tearleads/validators/operation";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import type { ApiNetworkError } from "./networkFailure";
import type { WriterProjectionListing } from "./verifiedManifestCitations";

export type HttpMethod = HttpOperationMethod;
export type RequestBody = BodyInit;

export type ListDocumentEditAttributionRangesOptions = Omit<
  DocumentAttributionRangesQuery,
  "cursor"
> & {
  cursor?: DocumentAttributionRangesQuery["cursor"] | null;
};

export interface RequestResultOptions {
  readonly signal?: AbortSignal | undefined;
  /** Expected target for a declared 402; mismatched response identities fail closed. */
  readonly expectedPaymentRequiredOrganizationId?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly reportErrors?: boolean | undefined;
  /** Called after this request or a concurrent request renews the same session. */
  readonly onSessionRenewed?: (() => void) | undefined;
  readonly retryOnSessionExpired?: boolean | "renew-only" | undefined;
  /**
   * Writer-projection reads only: where a listing placed the container, so
   * an unplaced container can cite its listed parent's held bytes. It
   * changes which hashes the read cites, never what the read accepts.
   */
  readonly projectionListing?: WriterProjectionListing | undefined;
}

export type OperationRequestFn = <T>(
  path: string,
  validator: (value: unknown) => value is T,
  method: HttpMethod,
  body: RequestBody | undefined,
  options: RequestResultOptions | undefined,
  failureOperation: HttpOperation,
) => Promise<T | null>;

export type OperationRequestResultFn = <T>(
  path: string,
  validator: (value: unknown) => value is T,
  method: HttpMethod,
  body: RequestBody | undefined,
  options: RequestResultOptions | undefined,
  failureOperation: HttpOperation,
) => Promise<RequestResult<T>>;

export type RequestFailureKind =
  | "storage"
  | "http"
  | "network"
  | "json"
  | "shape"
  | "cancelled"
  | "outcome-unknown";

export interface RequestFailure {
  readonly code?: string | undefined;
  readonly kind: RequestFailureKind;
  readonly message: string;
  readonly method: HttpMethod;
  /** Set when the fetch itself threw: what the client could observe, without secrets. */
  readonly networkError?: ApiNetworkError | undefined;
  readonly ok: false;
  readonly path: string;
  readonly report: () => void;
  readonly status: number | null;
  readonly statusText: string;
  readonly stalePrincipalHeads?: ReferencedPrincipalStateResponse[] | undefined;
  /**
   * With `container_descendant_rekeys_required`, the full owed set, parent-first;
   * with `container_descendant_rekeys_inaccessible`, its unwritable subset.
   * A hint, never authority; verify each container before signing for it.
   */
  readonly requiredContainerIds?: readonly string[] | undefined;
}

export interface RequestSuccess<T> {
  readonly data: T;
  readonly ok: true;
}

export type RequestResult<T> = RequestFailure | RequestSuccess<T>;

export interface ResponseRequestValidationFailureInput {
  readonly code?: string | undefined;
  readonly kind: RequestFailureKind;
  readonly message: string;
  readonly method: HttpMethod;
  readonly options?: RequestResultOptions | undefined;
  readonly path: string;
  readonly status: number | null;
  readonly statusText: string;
}

export interface OperationResponseRequestFn {
  (
    path: string,
    method: HttpMethod,
    body: RequestBody | undefined,
    options: RequestResultOptions | undefined,
    additionalSuccessStatuses: readonly number[],
    failureOperation: HttpOperation,
  ): Promise<RequestResult<Response>>;
  readonly reportFailure: (
    input: ResponseRequestValidationFailureInput,
  ) => RequestFailure;
}
