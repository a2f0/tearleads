import { loadServerConfig } from "./serverConfig";
import { createWebhooks } from "./webhookHandler";

const config = await loadServerConfig();
const webhooks = createWebhooks(config);

function isHandledEvent(
  name: string,
): name is "pull_request" | "pull_request_review_comment" {
  return name === "pull_request" || name === "pull_request_review_comment";
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response("ok\n");
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      const id = req.headers.get("x-github-delivery");
      const name = req.headers.get("x-github-event");
      const signature = req.headers.get("x-hub-signature-256");
      if (!id || !name || !signature) {
        return new Response("missing webhook headers\n", { status: 400 });
      }
      const body = await req.text();
      if (!(await webhooks.verify(body, signature))) {
        return new Response("invalid signature\n", { status: 401 });
      }
      // Acknowledge immediately; only handled events are dispatched (detached).
      if (isHandledEvent(name)) {
        void webhooks
          .receive({ id, name, payload: JSON.parse(body) })
          .catch((error: unknown) => {
            console.error("webhook receive failed", error);
          });
      }
      return new Response("accepted\n", { status: 202 });
    }

    return new Response("not found\n", { status: 404 });
  },
});

console.log(`tearleads-code-assist listening on :${server.port}`);
