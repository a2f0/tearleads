import type { RequestResultOptions } from "../../types";

/** Keep bearer URLs and application credentials out of object-store requests. */
export function storageFetchOptions(
  options: RequestResultOptions,
): RequestInit {
  return {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    ...(options.signal ? { signal: options.signal } : {}),
  };
}
