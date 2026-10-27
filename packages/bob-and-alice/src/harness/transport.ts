import { until } from "./until";

export interface ObservedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export interface Exchange extends ObservedRequest {
  status?: number;
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

/** Device-local HTTP proxy; requests still run through the real API. */
export class DeviceTransport {
  readonly history: Exchange[] = [];
  private readonly pending: NetworkGate[] = [];
  private readonly gates: NetworkGate[] = [];
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

  private async forward(request: Request): Promise<Response> {
    const { pathname, search } = new URL(request.url);
    const exchange: Exchange = {
      method: request.method,
      path: pathname,
      body: request.headers.get("content-type")?.includes("application/json")
        ? await request
            .clone()
            .json()
            .catch(() => null)
        : null,
    };
    this.history.push(exchange);
    const index = this.pending.findIndex((gate) => gate.matches(exchange));
    const gate = index < 0 ? undefined : this.pending.splice(index, 1)[0];
    if (
      gate?.phase === "before-request" &&
      (await gate.pause(exchange)) === "drop"
    ) {
      return new Response("Request dropped by test proxy", { status: 503 });
    }
    const response = await fetch(
      new Request(new URL(pathname + search, this.upstream), request),
      // Preserve wire bytes alongside content-encoding; the SDK decodes them.
      { decompress: false },
    );
    exchange.status = response.status;
    if (
      gate?.phase === "after-response" &&
      (await gate.pause(exchange)) === "drop"
    ) {
      // The server committed; the client never receives its acknowledgement.
      return new Response("Response dropped by test proxy", { status: 503 });
    }
    return response;
  }

  dispose(): void {
    for (const gate of this.gates) gate.drop();
    this.server.stop(true);
  }
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
