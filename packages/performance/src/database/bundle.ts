import { createHash } from "node:crypto";

export async function buildProbe() {
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/worker.ts`],
    // Workers' nodejs_compat supplies built-ins; node target also emits the
    // createRequire bridge needed by pg's CommonJS dependencies.
    target: "node",
    format: "esm",
    // workerd leaves import.meta.url undefined; createRequire only resolves
    // runtime built-ins here, so a stable virtual bundle URL is sufficient.
    define: { "import.meta.url": JSON.stringify("file:///probe.js") },
    external: ["cloudflare:sockets", "pg-native"],
  });
  if (!build.success || build.outputs.length !== 1)
    throw new Error(`Probe build failed: ${build.logs.map(String).join("\n")}`);
  const code = await build.outputs[0]?.text();
  if (!code) throw new Error("Empty Worker bundle.");
  return {
    blob: new Blob([code], { type: "application/javascript+module" }),
    sha256: createHash("sha256").update(code).digest("hex"),
  };
}
