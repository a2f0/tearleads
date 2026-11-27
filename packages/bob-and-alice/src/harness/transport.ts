import { until } from "./until";

export interface ObservedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export interface Exchange extends ObservedRequest {
  status?: number;
  /** The `code` of a refused response's JSON body. */
  errorCode?: string;
}

type Phase = "before-request" | "after-response";
type Decision = "release" | "drop";

/** A single request or response held at an explicit network boundary. */
export class NetworkGate {
  private exchange: Exchange | null = null;
  private resolve: (decision: Decision) => void = () => {};
  private readonly decision = new Promise<Decision>((resolve) => {
    this.resolve = resolve;
  });

  constructor(
    readonly phase: Phase,
    readonly matches: (request: ObservedRequest) => boolean,
  ) {}

  async wait(): Promise<Exchange> {
    await until(() => this.exchange !== null, `network gate ${this.phase}`);
    if (!this.exchange) throw new Error("Network gate was not reached");
    return this.exchange;
  }

  pause(exchange: Exchange): Promise<Decision> {
    this.exchange = exchange;
    return this.decision;
  }

  release(): void {
    this.resolve("release");
  }
  drop(): void {
    this.resolve("drop");
  }
}

interface BodyRewrite {
  readonly matches: (request: ObservedRequest) => boolean;
  readonly rewrite: (body: unknown) => unknown;
}

interface ResponseOverride {
  readonly matches: (request: ObservedRequest) => boolean;
  readonly respond: (request: ObservedRequest) => Response | null;
}

/** Device-local HTTP proxy; requests still run through the real API. */
export class DeviceTransport {
  readonly history: Exchange[] = [];
  private readonly pending: NetworkGate[] = [];
  private readonly gates: NetworkGate[] = [];
  private readonly overrides: ResponseOverride[] = [];
  private readonly rewrites: BodyRewrite[] = [];
  private readonly requestRewrites: BodyRewrite[] = [];
  private readonly server: ReturnType<typeof Bun.serve>;

  constructor(private readonly upstream: string) {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 60,
      fetch: (request) => this.forward(request),
    });
  }

  get origin(): string {
    return this.server.url.origin;
  }

  hold(
    phase: Phase,
    matches: (request: ObservedRequest) => boolean,
  ): NetworkGate {
    const gate = new NetworkGate(phase, matches);
    this.pending.push(gate);
    this.gates.push(gate);
    return gate;
  }

  /**
   * Answers matching requests directly without forwarding upstream, when
   * `respond` returns a `Response`. Returning `null` forwards normally.
   */
  overrideResponses(
    matches: ResponseOverride["matches"],
    respond: ResponseOverride["respond"],
  ): void {
    this.overrides.push({ matches, respond });
  }

  /**
   * Replaces the JSON body of every matching successful response from now on,
   * as a dishonest server would serve it. The API itself stays honest.
   */
  rewriteResponses(
    matches: BodyRewrite["matches"],
    rewrite: BodyRewrite["rewrite"],
  ): void {
    this.rewrites.push({ matches, rewrite });
  }

  /**
   * Replaces the JSON body of every matching request from now on, before the
   * API sees it, as a client that asks for something else would send it: a
   * smaller page, as a device isolating an update asks for. Recorded
   * exchanges keep the body the SDK sent.
   */
  rewriteRequests(
    matches: BodyRewrite["matches"],
    rewrite: BodyRewrite["rewrite"],
  ): void {
    this.requestRewrites.push({ matches, rewrite });
  }

  /** The request the API is sent: the SDK's, or its rewritten JSON body. */
  private upstreamRequest(exchange: Exchange, request: Request): Request {
    const { pathname, search } = new URL(request.url);
    const url = new URL(pathname + search, this.upstream);
    const rewrites = this.requestRewrites.filter((entry) =>
      entry.matches(exchange),
    );
    if (rewrites.length === 0 || exchange.body === null) {
      return new Request(url, request);
    }
    let body: unknown = exchange.body;
    for (const entry of rewrites) body = entry.rewrite(body);
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    // Everything of the SDK's request but its body: a rewritten request is
    // still cancelled with its sender and follows redirects as it would.
    return new Request(url, {
      body: JSON.stringify(body),
      headers,
      method: request.method,
      redirect: request.redirect,
      signal: request.signal,
    });
  }

  private async rewritten(
    exchange: Exchange,
    response: Response,
  ): Promise<Response> {
    const rewrites = this.rewrites.filter((entry) => entry.matches(exchange));
    if (rewrites.length === 0 || !response.ok) return response;
    let body: unknown = await response.json();
    for (const entry of rewrites) body = entry.rewrite(body);
    return Response.json(body, { status: response.status });
  }

  private matchOverride(exchange: Exchange): Response | null {
    for (const entry of this.overrides) {
      if (!entry.matches(exchange)) continue;
      const synthetic = entry.respond(exchange);
      if (synthetic) return synthetic;
    }
    return null;
  }

  private async forward(request: Request): Promise<Response> {
    const exchange = await observeRequest(request);
    this.history.push(exchange);
    const index = this.pending.findIndex((gate) => gate.matches(exchange));
    const gate = index < 0 ? undefined : this.pending.splice(index, 1)[0];
    // A deliberate hold may outlast Bun's normal socket idle timeout.
    if (gate) this.server.timeout(request, 0);
    if (
      gate?.phase === "before-request" &&
      (await gate.pause(exchange)) === "drop"
    ) {
      return new Response("Request dropped by test proxy", { status: 503 });
    }
    const synthetic = this.matchOverride(exchange);
    if (synthetic) {
      await recordResponse(exchange, synthetic);
      return synthetic;
    }
    const response = await fetch(
      this.upstreamRequest(exchange, request),
      // Preserve wire bytes alongside content-encoding; the SDK decodes them.
      { decompress: false },
    );
    await recordResponse(exchange, response);
    if (
      gate?.phase === "after-response" &&
      (await gate.pause(exchange)) === "drop"
    ) {
      // The server committed; the client never receives its acknowledgement.
      await response.body?.cancel();
      return new Response("Response dropped by test proxy", { status: 503 });
    }
    return this.rewritten(exchange, response);
  }

  dispose(): void {
    for (const gate of this.gates) gate.drop();
    this.server.stop(true);
  }
}

async function observeRequest(request: Request): Promise<Exchange> {
  const { pathname } = new URL(request.url);
  const body = request.headers.get("content-type")?.includes("application/json")
    ? await request
        .clone()
        .json()
        .catch(() => null)
    : null;
  return { method: request.method, path: pathname, body };
}

async function recordResponse(
  exchange: Exchange,
  response: Response,
): Promise<void> {
  exchange.status = response.status;
  const code = response.ok ? undefined : await errorCode(response);
  if (code !== undefined) exchange.errorCode = code;
}

/** The `code` of an uncompressed JSON error body, read from a copy. */
async function errorCode(response: Response): Promise<string | undefined> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return undefined;
  if (response.headers.has("content-encoding")) return undefined;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
    ? body.code
    : undefined;
}

export function documentWrite(documentId: string) {
  return (request: ObservedRequest): boolean => {
    const { body } = request;
    return (
      request.method === "POST" &&
      request.path.endsWith(`/documents/${documentId}/sync`) &&
      typeof body === "object" &&
      body !== null &&
      "outgoingUpdates" in body &&
      Array.isArray(body.outgoingUpdates) &&
      body.outgoingUpdates.length > 0
    );
  };
}
