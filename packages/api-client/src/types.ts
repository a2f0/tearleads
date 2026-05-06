export type HttpMethod = "DELETE" | "GET" | "POST";

export type RequestFn = <T>(
  path: string,
  validator: (value: unknown) => value is T,
  method: HttpMethod,
  body?: string,
) => Promise<T | null>;

export type RequestFailureKind = "http" | "network" | "json" | "shape";

export interface RequestFailure {
  readonly kind: RequestFailureKind;
  readonly message: string;
  readonly method: HttpMethod;
  readonly ok: false;
  readonly path: string;
  readonly report: () => void;
  readonly status: number | null;
  readonly statusText: string;
}

export interface RequestSuccess<T> {
  readonly data: T;
  readonly ok: true;
}

export type RequestResult<T> = RequestFailure | RequestSuccess<T>;

export interface RequestResultOptions {
  readonly reportErrors?: boolean | undefined;
}
