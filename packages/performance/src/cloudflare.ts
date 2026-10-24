import { type CostEvent, sanitizeCostEvent } from "./costEvents";
import { jsonRecord } from "./jsonRecord";
import { runHeader } from "./transport";

function tailApi(worker: string) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } =
    process.env;
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token) {
    throw new Error(
      "--cloudflare needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
    );
  }
  // Capture fetch before the experiment installs its API-only transport.
  const transport = globalThis.fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/tails`;
  async function api(url: string, method: string, body?: string) {
    const response = await transport(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Cloudflare tail ${method} failed (HTTP ${response.status}).`,
      );
    return response;
  }
  return { endpoint, api };
}

export async function openCloudflareTail(worker: string, runId: string) {
  const { endpoint, api } = tailApi(worker);
  const response = await api(
    endpoint,
    "POST",
    JSON.stringify({
      filters: [{ header: { key: runHeader, query: runId } }],
    }),
  );
  const result = jsonRecord(
    Reflect.get(jsonRecord(await response.json()), "result"),
  );
  const id: unknown = Reflect.get(result, "id");
  const url: unknown = Reflect.get(result, "url");
  if (
    typeof id !== "string" ||
    !id ||
    typeof url !== "string" ||
    !url.startsWith("wss://")
  )
    throw new Error("Invalid Cloudflare tail response.");
  const deleteUrl = `${endpoint}/${encodeURIComponent(id)}`;
  const events: CostEvent[] = [];
  const warnings: string[] = [];
  let closing = false;
  let socket: WebSocket | undefined;
  async function close() {
    closing = true;
    socket?.close();
    try {
      await api(deleteUrl, "DELETE");
    } catch {
      warnings.push(
        "Tail session deletion failed; it will expire automatically.",
      );
    }
  }
  try {
    const connection = new WebSocket(url, "trace-v1");
    socket = connection;
    connection.binaryType = "arraybuffer";
    connection.addEventListener("message", (event) => {
      try {
        const data: unknown = event.data;
        const text =
          typeof data === "string"
            ? data
            : data instanceof ArrayBuffer
              ? new TextDecoder().decode(data)
              : "";
        const sanitized = sanitizeCostEvent(JSON.parse(text), runId);
        if (sanitized && events.length < 500) events.push(sanitized);
      } catch {
        if (!warnings.includes("Unparseable tail event omitted."))
          warnings.push("Unparseable tail event omitted.");
      }
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Cloudflare tail connection timed out.")),
        15_000,
      );
      connection.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          connection.send(JSON.stringify({ debug: false }));
          resolve();
        },
        { once: true },
      );
      connection.addEventListener("error", () => {
        clearTimeout(timer);
        if (!closing) warnings.push("Cloudflare tail connection failed.");
        reject(new Error("Cloudflare tail connection failed."));
      });
      connection.addEventListener("close", () => {
        clearTimeout(timer);
        if (!closing)
          warnings.push("Cloudflare tail closed before capture finished.");
        reject(new Error("Cloudflare tail closed before capture started."));
      });
    });
  } catch (error) {
    await close();
    throw error;
  }
  return { events, warnings, close };
}
