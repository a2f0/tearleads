type RenewSession = (() => boolean | Promise<boolean>) | null;

/** An identity change invalidates renewal evidence, including an awaited callback. */
export class SessionRenewalTracker {
  private revision = 0;
  private known: { from: string; to: string } | null = null;
  private inFlight: { from: string; promise: Promise<boolean> } | null = null;

  constructor(private readonly readToken: () => string | null) {}

  tokenChanged(): void {
    this.revision += 1;
    this.known = null;
  }

  isKnown(from: string, to: string): boolean {
    return this.known?.from === from && this.known.to === to;
  }

  currentToken(from: string | null): string | null {
    const token = this.readToken();
    return from && token && this.isKnown(from, token) ? token : null;
  }

  pending(from: string): Promise<boolean> | null {
    return this.inFlight?.from === from ? this.inFlight.promise : null;
  }

  async renew(handler: RenewSession): Promise<boolean> {
    const from = this.readToken();
    if (!from) return false;
    const existing = this.pending(from);
    if (existing) return existing;
    const pending = {
      from,
      promise: this.complete(from, this.revision, handler),
    };
    this.inFlight = pending;
    try {
      return await pending.promise;
    } finally {
      if (this.inFlight === pending) this.inFlight = null;
    }
  }

  private async complete(
    from: string,
    revision: number,
    handler: RenewSession,
  ): Promise<boolean> {
    const renewed = await (handler?.() ?? false);
    const to = this.readToken();
    // The trusted callback authenticates the same identity and installs one
    // replacement token. A second transition cannot borrow that renewal.
    if (renewed && to && from !== to && this.revision === revision + 1)
      this.known = { from, to };
    return renewed;
  }
}
