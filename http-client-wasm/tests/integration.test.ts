import { describe, test, expect, beforeAll, afterAll } from "bun:test";
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

  // Read the "listening on <addr>" line from stdout
  const reader = server.stdout.getReader();
  const { value } = await reader.read();
  const output = new TextDecoder().decode(value);
  const match = output.match(/listening on (.+)/);
  if (!match) {
    throw new Error(`Unexpected server output: ${output}`);
  }
  baseUrl = `http://${match[1]}`;
  reader.releaseLock();
});

afterAll(() => {
  server.kill();
});

describe("wasm client", () => {
  test("write and read", async () => {
    const client = new Client(baseUrl);

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

    client.free();
  });

  test("read not found", async () => {
    const client = new Client(baseUrl);

    const tuple = await client.read("node", "missing", "owner", "nobody");
    expect(tuple).toBeUndefined();

    client.free();
  });

  test("delete", async () => {
    const client = new Client(baseUrl);

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

    client.free();
  });

  test("delete not found", async () => {
    const client = new Client(baseUrl);

    const deleted = await client.delete(
      "node",
      "nonexistent",
      "owner",
      "alice",
    );
    expect(deleted).toBe(false);

    client.free();
  });
});
