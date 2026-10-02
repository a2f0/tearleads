import { reportBackgroundFailure } from "../diagnostics/reportBackgroundFailure";
import { isLiveUserSession } from "../middleware/session";
import {
  type ProofAgePolicy,
  RevalidationSchedule,
  type RevalidationScheduleOptions,
} from "./containerInterestRevalidation";
import { socketSessionKey, type WsConnection } from "./wsConnection";
import type { WebSocketTicketIdentity, WsSessionValidator } from "./wsIdentity";
import {
  SESSION_ENDED_CLOSE,
  SESSION_UNVERIFIED_CLOSE,
  type SessionClose,
  type WsEventRouter,
} from "./wsRouting";

/**
 * Sessions a subscriber reconnect checks at once. A read that times out stays
 * outstanding, but later checks join it, so a hung store holds at most one
 * read per session.
 */
const RECONNECT_CHECK_CONCURRENCY = 16;

export interface WsSessionLivenessOptions {
  readonly router: WsEventRouter;
  /** Its `maxProofAgeMs` also bounds how long a session may go unconfirmed. */
  readonly policy: ProofAgePolicy;
  /** How long one check waits on a session read before reporting it failed. */
  readonly readTimeoutMs: number;
  readonly revalidation?: RevalidationScheduleOptions | undefined;
  readonly validateSession?: WsSessionValidator | undefined;
}

interface TrackedSession {
  readonly identity: WebSocketTicketIdentity;
  readonly sockets: Set<WsConnection>;
  /** When the store, or a ticket upgrade, last confirmed the session live. */
  confirmedAt: number;
  cancelDeadline: () => void;
  /** The store read in flight; later checks join it instead of adding reads. */
  read: Promise<void> | null;
}

class SessionReadTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Session read did not answer within ${timeoutMs} ms`);
    this.name = "SessionReadTimeoutError";
  }
}

/**
 * A socket's session is checked once at upgrade. Revocation is published at
 * most once and expiry not at all, so each session gets its own jittered
 * recheck, one store read per interval however many sockets it has, and every
 * subscriber reconnect rechecks each open session once (#2365 finding 27). An
 * ended session's sockets close.
 *
 * The session store may hang or fail through the same outage that caused a
 * reconnect. A check waits at most `readTimeoutMs`, joins a read still in
 * flight rather than adding another, and never holds back proof
 * re-verification. A failure only delays the close to the next check, up to
 * a deadline: like installed proofs, a session the store has not confirmed for
 * `maxProofAgeMs` closes its sockets, so failing reads never extend it. With
 * rechecks disabled (`intervalMs` 0) a session is checked only on reconnect
 * and has no deadline.
 */
export class WsSessionLiveness {
  private readonly sessions = new Map<string, TrackedSession>();
  private readonly schedule: RevalidationSchedule<string>;
  private readonly timeouts = new Set<() => void>();
  private readonly validateSession: WsSessionValidator;
  private stopped = false;

  constructor(private readonly options: WsSessionLivenessOptions) {
    this.validateSession = options.validateSession ?? isLiveUserSession;
    this.schedule = new RevalidationSchedule(
      (key) => this.checkSessions([key]),
      options.revalidation,
    );
  }

  /** Tracks a socket whose ticket upgrade has just confirmed its session. */
  open(ws: WsConnection): void {
    const key = socketSessionKey(ws);
    const now = this.options.policy.now();
    const tracked = this.sessions.get(key);
    if (tracked) {
      tracked.sockets.add(ws);
      this.confirm(key, tracked, now);
      return;
    }
    const session: TrackedSession = {
      cancelDeadline: () => undefined,
      confirmedAt: Number.NEGATIVE_INFINITY,
      identity: ws.data,
      read: null,
      sockets: new Set([ws]),
    };
    this.sessions.set(key, session);
    this.confirm(key, session, now);
    this.schedule.open(key);
  }

  close(ws: WsConnection): void {
    const key = socketSessionKey(ws);
    const session = this.sessions.get(key);
    if (!session) return;
    session.sockets.delete(ws);
    if (session.sockets.size === 0) this.forget(key, session);
  }

  /** Rechecks each open session once, a bounded number at a time. */
  checkAll(): Promise<void> {
    return this.checkSessions([...this.sessions.keys()]);
  }

  /** Disarms every timer; checks still in flight neither close nor report. */
  stop(): void {
    this.stopped = true;
    this.schedule.stop();
    for (const cancel of this.timeouts) cancel();
    this.timeouts.clear();
    for (const session of this.sessions.values()) session.cancelDeadline();
    this.sessions.clear();
  }

  private async checkSessions(keys: readonly string[]): Promise<void> {
    const failures: unknown[] = [];
    const pending = [...keys].reverse();
    const worker = async () => {
      for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
        await this.check(key).catch((error: unknown) => {
          failures.push(error);
        });
      }
    };
    const workers = Math.min(RECONNECT_CHECK_CONCURRENCY, keys.length);
    await Promise.all(Array.from({ length: workers }, worker));
    this.report(failures);
  }

  private check(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return Promise.resolve();
    session.read ??= this.startRead(key, session);
    return this.withTimeout(session.read);
  }

  private withTimeout(read: Promise<void>): Promise<void> {
    const { readTimeoutMs } = this.options;
    return new Promise((resolve, reject) => {
      const cancel = this.options.policy.schedule(() => {
        this.timeouts.delete(cancel);
        reject(new SessionReadTimeoutError(readTimeoutMs));
      }, readTimeoutMs);
      this.timeouts.add(cancel);
      const settle = () => {
        this.timeouts.delete(cancel);
        cancel();
      };
      read.then(
        () => {
          settle();
          resolve();
        },
        (error: unknown) => {
          settle();
          reject(error);
        },
      );
    });
  }

  private startRead(key: string, session: TrackedSession): Promise<void> {
    const startedAt = this.options.policy.now();
    const read = Promise.resolve()
      .then(() => this.validateSession(session.identity))
      .then((live) => {
        if (this.sessions.get(key) !== session) return;
        if (live) this.confirm(key, session, startedAt);
        else this.end(key, session, SESSION_ENDED_CLOSE);
      })
      .finally(() => {
        if (session.read === read) session.read = null;
      });
    return read;
  }

  /** Moves the deadline to `at + maxProofAgeMs`; it never moves back. */
  private confirm(key: string, session: TrackedSession, at: number): void {
    if (at <= session.confirmedAt) return;
    session.confirmedAt = at;
    session.cancelDeadline();
    const { maxProofAgeMs, now, schedule } = this.options.policy;
    // Without rechecks only a reconnect could confirm it; no deadline then.
    if (maxProofAgeMs <= 0 || !this.schedule.enabled) return;
    session.cancelDeadline = schedule(
      () => this.end(key, session, SESSION_UNVERIFIED_CLOSE),
      Math.max(0, at + maxProofAgeMs - now()),
    );
  }

  private end(key: string, session: TrackedSession, close: SessionClose) {
    if (!this.forget(key, session)) return;
    const { userId, sessionId } = session.identity;
    this.options.router.closeSession(userId, sessionId, close);
  }

  private forget(key: string, session: TrackedSession): boolean {
    if (this.sessions.get(key) !== session) return false;
    session.cancelDeadline();
    this.sessions.delete(key);
    this.schedule.close(key);
    return true;
  }

  private report(failures: readonly unknown[]): void {
    if (this.stopped || failures.length === 0) return;
    const [first] = failures;
    console.error(
      `Failed to check ${failures.length} websocket session(s) for liveness:`,
      first,
    );
    reportBackgroundFailure(first, "websocket.session");
  }
}
