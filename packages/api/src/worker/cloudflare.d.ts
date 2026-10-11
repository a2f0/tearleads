// Minimal ambient declarations for the Cloudflare Workers runtime surface the
// API uses. The workspace compiles against Bun's globals, and the full
// `@cloudflare/workers-types` package redeclares Request, Response, and
// WebSocket in ways that conflict with them, so only the pieces the Worker
// entry and Durable Objects need are declared here.

declare module "cloudflare:workers" {
  abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
    fetch?(request: Request): Response | Promise<Response>;
    alarm?(): void | Promise<void>;
  }

  export { DurableObject };
}

declare module "*.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

interface SqlStorageCursor<Row> extends Iterable<Row> {
  toArray(): Row[];
}

interface SqlStorage {
  exec<Row = Record<string, unknown>>(
    query: string,
    ...bindings: readonly (string | number | null)[]
  ): SqlStorageCursor<Row>;
}

interface DurableObjectStorage {
  readonly sql: SqlStorage;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface DurableObjectId {
  toString(): string;
}

type DurableObjectRpcMethods<T> = {
  readonly [Key in keyof T as T[Key] extends (...args: never[]) => unknown
    ? Key
    : never]: T[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : never;
};

type DurableObjectStub<T> = DurableObjectRpcMethods<T> & {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

interface DurableObjectNamespaceGetOptions {
  readonly locationHint?: string;
}

interface DurableObjectNamespace<T> {
  idFromName(name: string): DurableObjectId;
  get(
    id: DurableObjectId,
    options?: DurableObjectNamespaceGetOptions,
  ): DurableObjectStub<T>;
}

interface ExecutionContext {
  readonly props: Record<string, unknown>;
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}

/** The server half of a `WebSocketPair`, before and after `accept()`. */
interface CloudflareServerWebSocket extends WebSocket {
  accept(): void;
}

interface CloudflareWebSocketPair {
  readonly 0: WebSocket;
  readonly 1: CloudflareServerWebSocket;
}

declare const WebSocketPair: new () => CloudflareWebSocketPair;

interface ResponseInit {
  /** Workers-only: the client half of an accepted WebSocket upgrade. */
  webSocket?: WebSocket | null;
}

// The XML builder package publishes no `exports` map, so its Node files are
// importable by path; their types live under dist-types.
declare module "@aws-sdk/xml-builder/dist-es/XmlNode.js" {
  export { XmlNode } from "@aws-sdk/xml-builder";
}
declare module "@aws-sdk/xml-builder/dist-es/XmlText.js" {
  export { XmlText } from "@aws-sdk/xml-builder";
}
declare module "@aws-sdk/xml-builder/dist-es/xml-parser.js" {
  export { parseXML } from "@aws-sdk/xml-builder";
}
