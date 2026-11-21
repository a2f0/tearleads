/**
 * The callers sharing one in-flight request. It stays current while any caller
 * is, and an unscoped caller keeps it current. Once every scoped caller has
 * retired, the transport neither renews the session for it nor handles its
 * response.
 */
export class SharedRequestScope {
  private unscoped = false;
  private readonly scopes: Array<() => boolean> = [];

  constructor(first: (() => boolean) | undefined) {
    this.join(first);
  }

  join(stillCurrent: (() => boolean) | undefined): void {
    if (stillCurrent) this.scopes.push(stillCurrent);
    else this.unscoped = true;
  }

  readonly current = (): boolean =>
    this.unscoped || this.scopes.some((stillCurrent) => stillCurrent());
}
