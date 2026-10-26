import { expect, test } from "bun:test";
import type { CloudflareApi } from "./cloudflareApi";
import { deployTemporaryWorker } from "./temporaryWorker";

const config = {
  hyperdriveId: "drive",
  poolBindings: [],
  placement: { mode: "targeted", target: [1] },
  uploadPlacement: { mode: "targeted", region: "aws:us-east-1" },
  compatibilityDate: "2026-08-17",
  compatibilityFlags: ["nodejs_compat"],
  subdomain: "test-account",
};
const input = {
  name: "tl-db-probe-production-00000000-0000-4000-8000-000000000000",
  runId: "run",
  token: "secret",
  expires: 123,
  bundle: new Blob(["worker"]),
  config,
};

function fixture(existing = false, failAddress = false) {
  let exists = existing;
  const calls: string[] = [];
  let metadata = "";
  const api: CloudflareApi = async (path, method = "GET", body) => {
    calls.push(`${method} ${path}`);
    if (method === "PUT") {
      if (!(body instanceof FormData))
        throw new Error("Expected multipart upload");
      metadata = String(body.get("metadata"));
      exists = true;
      return {};
    }
    if (method === "DELETE") {
      exists = false;
      return {};
    }
    if (method === "POST" && failAddress) throw new Error("address failed");
    if (method === "GET")
      return exists ? { placement: config.placement } : null;
    return {};
  };
  return { api, calls, metadata: () => metadata, exists: () => exists };
}

test("publishes a bounded probe with only the selected bindings, then confirms deletion", async () => {
  const f = fixture();
  const worker = await deployTemporaryWorker(f.api, input);
  const metadata = JSON.parse(f.metadata());
  expect(metadata.bindings.map((b: { name: string }) => b.name)).toEqual([
    "HYPERDRIVE",
    "PROBE_TOKEN",
    "PROBE_RUN",
    "PROBE_EXPIRES",
  ]);
  expect(metadata.placement).toEqual(config.uploadPlacement);
  expect(worker.origin).toBe(`https://${input.name}.test-account.workers.dev`);
  await worker.close();
  expect(f.exists()).toBe(false);
  expect(f.calls.slice(-2)).toEqual([
    `DELETE /workers/scripts/${input.name}`,
    `GET /workers/scripts/${input.name}/settings`,
  ]);
});

test("a partial deployment is deleted if its address setup fails", async () => {
  const f = fixture(false, true);
  await expect(deployTemporaryWorker(f.api, input)).rejects.toThrow(
    "address failed",
  );
  expect(f.exists()).toBe(false);
  expect(f.calls.some((call) => call.startsWith("DELETE"))).toBe(true);
});

test("a cleanup failure preserves the original deployment error", async () => {
  const f = fixture(false, true);
  const api: CloudflareApi = (path, method, body) => {
    if (method === "DELETE") throw new Error("delete failed");
    return f.api(path, method, body);
  };
  await expect(deployTemporaryWorker(api, input)).rejects.toThrow(
    "address failed",
  );
});

test("placement drift aborts deployment and deletes the temporary Worker", async () => {
  const f = fixture();
  await expect(
    deployTemporaryWorker(f.api, {
      ...input,
      config: { ...config, placement: { mode: "targeted", target: [2] } },
    }),
  ).rejects.toThrow("placement differs");
  expect(f.exists()).toBe(false);
});

test("existing Workers and API names are never overwritten or deleted", async () => {
  const f = fixture(true);
  await expect(deployTemporaryWorker(f.api, input)).rejects.toThrow(
    "already exists",
  );
  await expect(
    deployTemporaryWorker(f.api, {
      ...input,
      name: "tearleads-platform-api-prod",
    }),
  ).rejects.toThrow("non-probe");
  expect(f.calls).toHaveLength(1);
  expect(f.exists()).toBe(true);
});
