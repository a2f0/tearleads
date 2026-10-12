import { createServer } from "node:http";
import { createTestHarness } from "wrangler";
import type { GatewaySocketSnapshot } from "../../src/realtime/gatewayHibernation";

// Node hosts Wrangler: Bun's implementation cannot serve its proxy reliably.
// This controller exists only in the test process, never in the Worker bundle.
const varsKey = "HIBERNATION_TEST_VARS";
const vars: Record<string, string> = JSON.parse(process.env[varsKey] ?? "{}");
const harness = createTestHarness({
  workers: [
    { configPath: "wrangler.jsonc", env: "local", vars },
    {
      config: {
        name: "hibernation-control",
        main: "test/helpers/hibernationControlWorker.ts",
        compatibility_date: "2026-08-17",
        durable_objects: {
          bindings: [
            {
              name: "REALTIME_HUB",
              class_name: "RealtimeHub",
              script_name: "tearleads-platform-api-local",
            },
            {
              name: "KEY_VALUE_STORE",
              class_name: "KeyValueStore",
              script_name: "tearleads-platform-api-local",
            },
          ],
        },
      },
    },
  ],
});
const { url } = await harness.listen();
const worker = harness.getWorker();
const control = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as {
      kind: string;
      message?: string;
      token?: string;
    };
    console.log(`Hibernation command ${input.kind}`);
    if (input.kind === "hibernate") {
      await worker.evictDurableObject("RealtimeHub", {
        name: "hub",
        webSockets: "hibernate",
      });
    } else if (input.kind === "publish" || input.kind === "expire-session") {
      const reply = await harness
        .getWorker("hibernation-control")
        .fetch("http://control/", {
          method: "POST",
          body: JSON.stringify(input),
        });
      if (!reply.ok) throw new Error(await reply.text());
      await reply.text();
    } else if (
      input.kind === "schedule-session-check" ||
      input.kind === "expire-proofs"
    ) {
      const sql = await worker.getDurableObjectStorage("RealtimeHub", {
        name: "hub",
      });
      const rows = await sql.exec<{
        id: string;
        part: number;
        snapshot: string;
      }>("SELECT id, part, snapshot FROM realtime_socket_chunks");
      for (const row of rows) {
        if (
          row.part !== 0 ||
          typeof row.id !== "string" ||
          typeof row.snapshot !== "string"
        )
          throw new Error("Expected a small socket fixture");
        const saved: GatewaySocketSnapshot = JSON.parse(row.snapshot);
        const updated =
          input.kind === "expire-proofs"
            ? { ...saved, verifiedAt: Date.now() - 16 * 60_000 }
            : {
                ...saved,
                session: { ...saved.session, nextCheckAt: Date.now() + 1_000 },
              };
        await sql.exec(
          "UPDATE realtime_socket_chunks SET snapshot = ? WHERE id = ? AND part = 0",
          JSON.stringify(updated),
          row.id,
        );
      }
    } else {
      throw new Error("Unknown hibernation test command");
    }
    console.log(`Hibernation command ${input.kind} complete`);
    response.writeHead(200).end("ok");
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
control.listen(0, "127.0.0.1", () => {
  const address = control.address();
  if (!address || typeof address === "string")
    throw new Error("Missing controller address");
  process.stdout.write(
    `HIBERNATION_READY ${JSON.stringify({ origin: url.origin, control: `http://127.0.0.1:${address.port}` })}\n`,
  );
});
process.on("SIGTERM", () => {
  control.close();
  void harness.close().finally(() => process.exit());
});
