import { isDeepStrictEqual } from "node:util";
import { jsonRecord } from "../jsonRecord";
import type { CloudflareApi } from "./cloudflareApi";
import type { DeployedConfig } from "./deployedConfig";

interface WorkerInput {
  name: string;
  runId: string;
  token: string;
  expires: number;
  bundle: Blob;
  config: DeployedConfig;
}

export async function deployTemporaryWorker(
  api: CloudflareApi,
  input: WorkerInput,
) {
  const { name, config } = input;
  if (!/^tl-db-probe-(staging|production)-[a-f0-9-]{36}$/.test(name))
    throw new Error("Refusing to manage a non-probe Worker.");
  const path = `/workers/scripts/${name}`;
  if (await api(`${path}/settings`))
    throw new Error("Probe Worker already exists; refusing to overwrite it.");
  async function close() {
    await api(path, "DELETE");
    if (await api(`${path}/settings`))
      throw new Error(`Probe Worker deletion not confirmed: ${name}`);
  }
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      main_module: "index.js",
      compatibility_date: config.compatibilityDate,
      compatibility_flags: config.compatibilityFlags,
      placement: config.uploadPlacement,
      limits: { cpu_ms: 10_000 },
      observability: { enabled: false },
      bindings: [
        { type: "hyperdrive", name: "HYPERDRIVE", id: config.hyperdriveId },
        ...config.poolBindings,
        { type: "secret_text", name: "PROBE_TOKEN", text: input.token },
        { type: "plain_text", name: "PROBE_RUN", text: input.runId },
        {
          type: "plain_text",
          name: "PROBE_EXPIRES",
          text: String(input.expires),
        },
      ],
    }),
  );
  form.set("index.js", input.bundle, "index.js");
  try {
    if (!(await api(path, "PUT", form)))
      throw new Error("Worker upload failed.");
    if (
      !(await api(`${path}/subdomain`, "POST", {
        enabled: true,
        previews_enabled: false,
      }))
    )
      throw new Error("Worker address setup failed.");
    const settings = await api(`${path}/settings`);
    if (
      !isDeepStrictEqual(
        Reflect.get(jsonRecord(settings), "placement"),
        config.placement,
      )
    )
      throw new Error("Probe placement differs from the API.");
  } catch (error) {
    await close();
    throw error;
  }
  return { origin: `https://${name}.${config.subdomain}.workers.dev`, close };
}
