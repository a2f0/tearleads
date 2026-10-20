/**
 * Healthchecks.io pings for the blob garbage collector. The ping URL is a
 * secret; a failed or stalled ping is logged and never delays or fails the
 * maintenance run itself.
 */
export type HealthcheckSignal = "start" | "success" | "fail";

export type HealthcheckFetch = (
  url: string,
  init: { readonly method: "POST"; readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number }>;

export interface HealthcheckOptions {
  readonly fetchImpl?: HealthcheckFetch;
  /** How long one ping may take before it is abandoned. */
  readonly timeoutMs?: number;
}

const DEFAULT_PING_TIMEOUT_MS = 10_000;

function healthcheckEndpoint(url: string, signal: HealthcheckSignal): string {
  const base = url.replace(/\/+$/u, "");
  return signal === "success" ? base : `${base}/${signal}`;
}

export async function pingHealthcheck(
  url: string | undefined,
  signal: HealthcheckSignal,
  options: HealthcheckOptions = {},
): Promise<void> {
  const trimmed = url?.trim();
  if (!trimmed) {
    return;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(healthcheckEndpoint(trimmed, signal), {
      method: "POST",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PING_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Healthcheck ${signal} ping returned ${response.status}`);
    }
  } catch (error) {
    console.error(`Healthcheck ${signal} ping failed:`, error);
  }
}

/** Run maintenance between a start ping and a success or failure ping. */
export async function withHealthcheck<T>(
  url: string | undefined,
  run: () => Promise<T>,
  options: HealthcheckOptions = {},
): Promise<T> {
  await pingHealthcheck(url, "start", options);
  try {
    const result = await run();
    await pingHealthcheck(url, "success", options);
    return result;
  } catch (error) {
    await pingHealthcheck(url, "fail", options);
    throw error;
  }
}
