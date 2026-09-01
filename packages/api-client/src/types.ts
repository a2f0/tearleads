import type { DocumentAttributionRangesQuery } from "@tearleads/validators/operation";
import type {
  PrincipalPolicyBundleResponse,
  SyncWatermark,
} from "@tearleads/validators/response";

export type HttpMethod = "DELETE" | "GET" | "POST" | "PUT";
export type RequestBody = BodyInit;

export interface ListContainerDocumentsOptions {
  limit?: number;
  watermark?: SyncWatermark | null;
}

export type ListDocumentEditAttributionRangesOptions = Omit<
  DocumentAttributionRangesQuery,
  "cursor"
> & {
  cursor?: DocumentAttributionRangesQuery["cursor"] | null;
};

export interface RequestResultOptions {
  readonly headers?: Record<string, string> | undefined;
  readonly reportErrors?: boolean | undefined;
  readonly retryOnSessionExpired?: boolean | undefined;
}

export type RequestFn = <T>(
  path: string,
  validator: (value: unknown) => value is T,
  method: HttpMethod,
  body?: RequestBody,
  options?: RequestResultOptions,
) => Promise<T | null>;

export type RequestFailureKind = "http" | "network" | "json" | "shape";

export interface RequestFailure {
  readonly code?: string | undefined;
  readonly kind: RequestFailureKind;
  readonly message: string;
  readonly method: HttpMethod;
  readonly ok: false;
  readonly path: string;
  readonly report: () => void;
  readonly status: number | null;
  readonly statusText: string;
  readonly stalePrincipalPolicies?: PrincipalPolicyBundleResponse[] | undefined;
}

export interface RequestSuccess<T> {
  readonly data: T;
  readonly ok: true;
}

export type RequestResult<T> = RequestFailure | RequestSuccess<T>;

export interface ResponseRequestValidationFailureInput {
  readonly kind: RequestFailureKind;
  readonly message: string;
  readonly method: HttpMethod;
  readonly options?: RequestResultOptions | undefined;
  readonly path: string;
  readonly status: number | null;
  readonly statusText: string;
}

export interface ResponseRequestFn {
  (
    path: string,
    method: HttpMethod,
    body?: RequestBody,
    options?: RequestResultOptions,
  ): Promise<RequestResult<Response>>;
  readonly reportFailure: (
    input: ResponseRequestValidationFailureInput,
  ) => RequestFailure;
}
