/**
 * Healthchecks.io pings for the blob garbage collector, replacing the
 * systemd `ExecStartPre`/`ExecStartPost` wrapper. The ping URL is a secret;
 * a failed ping is logged and never fails the maintenance run itself.
 */
export type HealthcheckSignal = "start" | "success" | "fail";

export type HealthcheckFetch = (
  url: string,
  init: { readonly method: "POST" },
) => Promise<{ readonly ok: boolean; readonly status: number }>;

function healthcheckEndpoint(url: string, signal: HealthcheckSignal): string {
  const base = url.replace(/\/+$/u, "");
  return signal === "success" ? base : `${base}/${signal}`;
}

export async function pingHealthcheck(
  url: string | undefined,
  signal: HealthcheckSignal,
  fetchImpl: HealthcheckFetch = fetch,
): Promise<void> {
  const trimmed = url?.trim();
  if (!trimmed) {
    return;
  }
  try {
    const response = await fetchImpl(healthcheckEndpoint(trimmed, signal), {
      method: "POST",
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
  fetchImpl: HealthcheckFetch = fetch,
): Promise<T> {
  await pingHealthcheck(url, "start", fetchImpl);
  try {
    const result = await run();
    await pingHealthcheck(url, "success", fetchImpl);
    return result;
  } catch (error) {
    await pingHealthcheck(url, "fail", fetchImpl);
    throw error;
  }
}
