import { spawnSync } from "node:child_process";
import { browserRequestAllowed } from "../browser-policy";
import { settings } from "../settings";
import { model } from "./codex";
import { evaluate, inputSchema } from "./evaluate";

const auth = spawnSync("codex", ["login", "status"], { encoding: "utf8" });
if (auth.status !== 0 || !`${auth.stdout}${auth.stderr}`.includes("ChatGPT")) {
  throw new Error("The local Judge requires Codex signed in using ChatGPT");
}
const version = spawnSync("codex", ["--version"], {
  encoding: "utf8",
}).stdout.trim();
let active = false;
Bun.serve({
  hostname: "127.0.0.1",
  port: settings.judgePort,
  // Codex has its own deadline; artifact I/O must not consume that same window.
  idleTimeout: 0,
  maxRequestBodySize: 10 * 1024 * 1024,
  async fetch(request) {
    if (
      !browserRequestAllowed(
        {
          host: request.headers.get("host"),
          origin: request.headers.get("origin"),
          site: request.headers.get("sec-fetch-site"),
        },
        settings.judgePort,
        settings.portalPort,
      )
    )
      return new Response("Forbidden browser origin", { status: 403 });
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      return Response.json({
        status: "healthy",
        service: "judge",
        provider: "codex-cli",
        model,
        authentication: "ChatGPT",
        codexVersion: version,
        active,
      });
    }
    if (path !== "/api/v1/evaluate" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/json"
    )
      return new Response("Expected application/json", { status: 415 });
    const parsed = inputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return Response.json(
        { error: "Invalid evaluation input" },
        { status: 400 },
      );
    if (active)
      return Response.json(
        { error: "Judge is busy; retry evaluation" },
        { status: 503 },
      );
    active = true;
    try {
      return Response.json(await evaluate(parsed.data));
    } catch (error) {
      console.error("[codex-judge]", error);
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    } finally {
      active = false;
    }
  },
});
console.log(
  `Codex Judge: http://127.0.0.1:${settings.judgePort} (${version}, ${model})`,
);
