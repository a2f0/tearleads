export const readyEmptyContainerTree = {
  getSnapshot: () => ({ nodes: [], ready: true }),
  subscribe: () => () => undefined,
};

export class ServerEventsTestWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static instances: ServerEventsTestWebSocket[] = [];

  closeCalls = 0;
  readonly readyState = ServerEventsTestWebSocket.OPEN;
  readonly sent: string[] = [];
  readonly url: string;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    ServerEventsTestWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCalls += 1;
  }

  dispatchJsonMessage(message: Record<string, unknown>): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }

  dispatchInterestState(containerIds: string[]): void {
    this.dispatchJsonMessage({ type: "interest_state", containerIds });
  }

  acknowledgeLastContainerInterest(): void {
    const declarationId = Reflect.get(this.lastSentJson(), "declarationId");
    if (typeof declarationId !== "string") {
      throw new Error("Expected a container-interest declaration.");
    }
    this.dispatchJsonMessage({
      type: "known_containers_ack",
      declarationId,
    });
  }

  lastSentJson(): Record<string, unknown> {
    const value = JSON.parse(this.sent.at(-1) ?? "null") as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Expected the socket to have sent a JSON object.");
    }
    return value as Record<string, unknown>;
  }

  send(message: string): void {
    this.sent.push(message);
  }
}
