import { jsonRecord } from "../jsonRecord";
import { cloudflareFailure } from "./cloudflareErrors";

function defaultRuntime() {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } =
    process.env;
  return { account, token, fetch: globalThis.fetch };
}

export function createCloudflareApi(runtime = defaultRuntime()) {
  const { account, token } = runtime;
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token)
    throw new Error("Cloudflare account ID and API token are required.");
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  return async (
    path: string,
    method = "GET",
    body?: FormData | Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> => {
    const multipart = body instanceof FormData;
    const response = await runtime.fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(multipart ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: multipart ? body : JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `Cloudflare ${method} failed (HTTP ${response.status}). ${await cloudflareFailure(response, token, body)}`,
      );
    const envelope = jsonRecord(await response.json());
    if (Reflect.get(envelope, "success") !== true)
      throw new Error(`Cloudflare ${method} did not succeed.`);
    return jsonRecord(Reflect.get(envelope, "result"));
  };
}

export type CloudflareApi = ReturnType<typeof createCloudflareApi>;
