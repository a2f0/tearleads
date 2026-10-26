import { jsonRecord } from "../jsonRecord";
import type { CloudflareApi } from "./cloudflareApi";
import { readUploadPlacement } from "./placement";

function requiredString(record: unknown, key: string): string {
  const value: unknown = Reflect.get(jsonRecord(record), key);
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Missing deployed configuration: ${key}.`);
  return value;
}

export async function readDeployedConfig(
  api: CloudflareApi,
  worker: string,
  environment = "staging",
) {
  const settings = await api(`/workers/scripts/${worker}/settings`);
  const rawBindings = Reflect.get(jsonRecord(settings), "bindings");
  if (!Array.isArray(rawBindings)) throw new Error("Worker bindings missing.");
  const bindings = rawBindings.map(jsonRecord);
  const drive = bindings.find(
    (binding) => Reflect.get(binding, "name") === "HYPERDRIVE",
  );
  if (Reflect.get(jsonRecord(drive), "type") !== "hyperdrive")
    throw new Error("API must use a Hyperdrive binding.");
  const hyperdriveId = requiredString(drive, "id");
  const configuration = await api(`/hyperdrive/configs/${hyperdriveId}`);
  if (
    Reflect.get(
      jsonRecord(Reflect.get(jsonRecord(configuration), "caching")),
      "disabled",
    ) !== true
  )
    throw new Error("The probe requires the API's query cache to be disabled.");
  const poolBindings = [
    "POSTGRES_COALESCE_WRITES",
    "POSTGRES_POOL_MAX",
    "POSTGRES_POOL_MAX_USES",
    "POSTGRES_REQUEST_SCOPED",
  ].map((name) => ({
    type: "plain_text",
    name,
    text: requiredString(
      bindings.find((binding) => Reflect.get(binding, "name") === name),
      "text",
    ),
  }));
  if (poolBindings[0]?.text !== "true")
    throw new Error(
      "The probe expects the API's coalesced PostgreSQL transport.",
    );
  if (
    poolBindings.find(({ name }) => name === "POSTGRES_REQUEST_SCOPED")
      ?.text !== "true"
  )
    throw new Error("The probe requires the API's request-scoped pool.");
  const placement = jsonRecord(Reflect.get(jsonRecord(settings), "placement"));
  if (Object.keys(placement).length === 0)
    throw new Error("API placement configuration missing.");
  const compatibilityFlags: unknown = Reflect.get(
    jsonRecord(settings),
    "compatibility_flags",
  );
  if (
    !Array.isArray(compatibilityFlags) ||
    !compatibilityFlags.includes("nodejs_compat")
  )
    throw new Error("API Node compatibility configuration missing.");
  const subdomain = requiredString(
    await api("/workers/subdomain"),
    "subdomain",
  );
  if (!/^[a-z0-9-]+$/.test(subdomain))
    throw new Error("Invalid workers.dev subdomain.");
  return {
    hyperdriveId,
    poolBindings,
    placement,
    uploadPlacement: await readUploadPlacement(environment),
    compatibilityDate: requiredString(settings, "compatibility_date"),
    compatibilityFlags,
    subdomain,
  };
}

export type DeployedConfig = Awaited<ReturnType<typeof readDeployedConfig>>;
