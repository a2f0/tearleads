export type HttpMethod = "GET" | "POST";

export type RequestFn = <T>(
  path: string,
  validator: (value: unknown) => value is T,
  method: HttpMethod,
  body?: string,
) => Promise<T | null>;
