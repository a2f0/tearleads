import { DurableObject } from "cloudflare:workers";
import type { KeyValueStoreRpc } from "./contracts";
import { KEY_VALUE_SET_PAGE_SIZE } from "./environment";

// The Redis subset the API uses (strings with TTL, sets with TTL, atomic
// GETDEL and SET XX KEEPTTL), served by one SQLite-backed Durable Object. A
// Durable Object runs one event at a time, so every method below is atomic
// with respect to the others without explicit locking. Expiry is enforced on
// read and swept by an hourly alarm.

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

interface ValueRow {
  readonly value: string;
}

interface MemberRow {
  readonly member: string;
}

function expiresAt(ttlSeconds: number | undefined): number | null {
  return ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;
}

export class KeyValueStore extends DurableObject implements KeyValueStoreRpc {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const { sql } = ctx.storage;
      sql.exec(
        "CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS set_keys (key TEXT PRIMARY KEY, expires_at INTEGER)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS set_members (key TEXT NOT NULL, member TEXT NOT NULL, PRIMARY KEY (key, member))",
      );
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
      }
    });
  }

  get(key: string): string | null {
    const rows = this.ctx.storage.sql
      .exec<ValueRow>(
        "SELECT value FROM entries WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)",
        key,
        Date.now(),
      )
      .toArray();
    return rows[0]?.value ?? null;
  }

  set(key: string, value: string, ttlSeconds?: number): void {
    this.deleteSet(key);
    this.ctx.storage.sql.exec(
      "INSERT INTO entries (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
      key,
      value,
      expiresAt(ttlSeconds),
    );
  }

  /** `SET key value XX KEEPTTL`: update only a live entry, keeping its expiry. */
  setKeepTtl(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      "UPDATE entries SET value = ? WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)",
      value,
      key,
      Date.now(),
    );
  }

  getdel(key: string): string | null {
    const value = this.get(key);
    this.ctx.storage.sql.exec("DELETE FROM entries WHERE key = ?", key);
    return value;
  }

  del(key: string): void {
    this.ctx.storage.sql.exec("DELETE FROM entries WHERE key = ?", key);
    this.deleteSet(key);
  }

  expire(key: string, ttlSeconds: number): void {
    const deadline = expiresAt(ttlSeconds);
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE entries SET expires_at = ? WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)",
      deadline,
      key,
      now,
    );
    this.ctx.storage.sql.exec(
      "UPDATE set_keys SET expires_at = ? WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)",
      deadline,
      key,
      now,
    );
  }

  sadd(key: string, member: string): void {
    this.ctx.storage.sql.exec("DELETE FROM entries WHERE key = ?", key);
    if (!this.isLiveSet(key)) {
      this.deleteSet(key);
      this.ctx.storage.sql.exec(
        "INSERT INTO set_keys (key, expires_at) VALUES (?, NULL)",
        key,
      );
    }
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO set_members (key, member) VALUES (?, ?)",
      key,
      member,
    );
  }

  srem(key: string, member: string): void {
    if (!this.isLiveSet(key)) {
      this.deleteSet(key);
      return;
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM set_members WHERE key = ? AND member = ?",
      key,
      member,
    );
    const remaining = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM set_members WHERE key = ?",
        key,
      )
      .toArray();
    if ((remaining[0]?.count ?? 0) === 0) {
      this.deleteSet(key);
    }
  }

  /**
   * One page of a live set's members after a cursor, in member order. A
   * cursor rather than an offset keeps paging exact when the caller removes
   * members between pages, as session listing does with expired sessions.
   */
  smembers(key: string, after: string | null): string[] {
    if (!this.isLiveSet(key)) {
      return [];
    }
    return this.ctx.storage.sql
      .exec<MemberRow>(
        "SELECT member FROM set_members WHERE key = ? AND (? IS NULL OR member > ?) ORDER BY member LIMIT ?",
        key,
        after,
        after,
        KEY_VALUE_SET_PAGE_SIZE,
      )
      .toArray()
      .map((row) => row.member);
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const { sql } = this.ctx.storage;
    sql.exec(
      "DELETE FROM entries WHERE expires_at IS NOT NULL AND expires_at <= ?",
      now,
    );
    sql.exec(
      "DELETE FROM set_members WHERE key IN (SELECT key FROM set_keys WHERE expires_at IS NOT NULL AND expires_at <= ?)",
      now,
    );
    sql.exec(
      "DELETE FROM set_keys WHERE expires_at IS NOT NULL AND expires_at <= ?",
      now,
    );
    await this.ctx.storage.setAlarm(now + SWEEP_INTERVAL_MS);
  }

  private isLiveSet(key: string): boolean {
    const rows = this.ctx.storage.sql
      .exec<{ key: string }>(
        "SELECT key FROM set_keys WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)",
        key,
        Date.now(),
      )
      .toArray();
    return rows.length > 0;
  }

  private deleteSet(key: string): void {
    this.ctx.storage.sql.exec("DELETE FROM set_members WHERE key = ?", key);
    this.ctx.storage.sql.exec("DELETE FROM set_keys WHERE key = ?", key);
  }
}
