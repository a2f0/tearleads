import { resolve } from "node:path";
import { databaseVars, START_TIMEOUT_MS } from "./localWorker";

export async function startHibernatingWorker() {
  const child = Bun.spawn(
    [
      "node",
      "--experimental-strip-types",
      resolve(import.meta.dir, "hibernatingWorkerChild.ts"),
    ],
    {
      cwd: resolve(import.meta.dir, "../.."),
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        HIBERNATION_TEST_VARS: JSON.stringify({
          ...databaseVars(),
          POSTGRES_SSL: "false",
          POSTGRES_SSL_REJECT_UNAUTHORIZED: "false",
          API_PUBLIC_ORIGIN: "https://api.workerd.test",
          API_CORS_ORIGINS: "*",
          API_BILLING_RETURN_ORIGINS: "https://app.workerd.test",
          DOCUMENT_SYNC_CURSOR_HMAC_KEY: "workerd-cursor-key-".repeat(3),
        }),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let output = "";
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) output += new TextDecoder().decode(chunk);
  };
  void collect(child.stdout);
  void collect(child.stderr);
  const stop = async () => {
    child.kill();
    const kill = setTimeout(() => child.kill("SIGKILL"), 3_000);
    try {
      await child.exited;
    } finally {
      clearTimeout(kill);
    }
  };
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const ready = /HIBERNATION_READY (.+)/.exec(output)?.[1];
    if (ready) {
      const { origin, control } = JSON.parse(ready) as {
        origin: string;
        control: string;
      };
      return {
        origin,
        stop,
        logs: () => output,
        command: async (input: {
          kind: string;
          message?: string;
          token?: string;
        }) => {
          const response = await fetch(control, {
            method: "POST",
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(30_000),
          }).catch((error: unknown) => {
            throw new Error(
              `Hibernation command ${input.kind} failed: ${String(error)}\n${output.slice(-6000)}`,
            );
          });
          if (!response.ok) throw new Error(await response.text());
        },
      };
    }
    if (child.exitCode !== null || Date.now() >= deadline) {
      await stop();
      throw new Error(
        `Hibernation worker failed to start:\n${output.slice(-6000)}`,
      );
    }
    await Bun.sleep(100);
  }
}
