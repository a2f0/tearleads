import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { spawn, type Subprocess } from "bun";
import { initSync, Client } from "../pkg/http_client_wasm.js";

let server: Subprocess;
let baseUrl: string;

beforeAll(async () => {
  const wasmPath = resolve(
    import.meta.dir,
    "../pkg/http_client_wasm_bg.wasm",
  );
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });

  server = spawn({
    cmd: ["cargo", "run", "-p", "http-server", "--", "127.0.0.1:0"],
    cwd: resolve(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "ignore",
  });

  // Read from stdout until we find the "listening on <addr>" line
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
    const match = output.match(/listening on (.+)/);
    if (match) {
      baseUrl = `http://${match[1]}`;
      break;
    }
  }
  reader.releaseLock();
  if (!baseUrl) {
    throw new Error(`Could not find server address in output: ${output}`);
  }
});

afterAll(() => {
  server.kill();
});

describe("wasm client", () => {
  let client: Client;

  beforeEach(() => {
    client = new Client(baseUrl);
  });

  afterEach(() => {
    client.free();
  });

  test("write and read", async () => {
    await client.write(
      "node",
      "doc1",
      "owner",
      "alice",
      new TextEncoder().encode("hello world"),
    );

    const tuple = await client.read("node", "doc1", "owner", "alice");

    expect(tuple).toBeDefined();
    expect(tuple!.namespace).toBe("Node");
    expect(tuple!.object).toBe("doc1");
    expect(tuple!.relation).toBe("owner");
    expect(tuple!.subject).toBe("alice");
    expect(Buffer.from(tuple!.payload)).toEqual(
      Buffer.from("hello world"),
    );
  });

  test("read not found", async () => {
    const tuple = await client.read("node", "missing", "owner", "nobody");
    expect(tuple).toBeUndefined();
  });

  test("delete", async () => {
    await client.write(
      "node",
      "doc2",
      "editor",
      "bob",
      new TextEncoder().encode("data"),
    );

    const deleted = await client.delete("node", "doc2", "editor", "bob");
    expect(deleted).toBe(true);

    const tuple = await client.read("node", "doc2", "editor", "bob");
    expect(tuple).toBeUndefined();
  });

  test("delete not found", async () => {
    const deleted = await client.delete(
      "node",
      "nonexistent",
      "owner",
      "alice",
    );
    expect(deleted).toBe(false);
  });
});
