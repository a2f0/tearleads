import type { GatewaySocketSnapshot } from "../realtime/gatewayHibernation";
import type { WebSocketTicketIdentity } from "../realtime/wsIdentity";
import { parseHubSocketSnapshot } from "./hubSocketState";

export interface HubSocketAttachment {
  readonly id: string;
  readonly identity: WebSocketTicketIdentity;
}

// Interest sets may exceed both the 2 KiB attachment and 2 MB SQL value limits.
const CHUNK_CHARS = 16 * 1024;

/** Synchronous writes share a SQLite transaction and its WebSocket output gate. */
export class HubSocketStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS realtime_socket_chunks (id TEXT NOT NULL, part INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY (id, part))",
    );
  }

  load(id: string): GatewaySocketSnapshot | null {
    const rows = this.sql
      .exec<{ snapshot: string }>(
        "SELECT snapshot FROM realtime_socket_chunks WHERE id = ? ORDER BY part",
        id,
      )
      .toArray();
    return rows.length
      ? parseHubSocketSnapshot(rows.map((row) => row.snapshot).join(""))
      : null;
  }

  save(id: string, snapshot: GatewaySocketSnapshot): void {
    const encoded = JSON.stringify(snapshot);
    let part = 0;
    for (let start = 0; start < encoded.length; ) {
      let end = Math.min(start + CHUNK_CHARS, encoded.length);
      const last = encoded.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      this.sql.exec(
        "INSERT INTO realtime_socket_chunks (id, part, snapshot) VALUES (?, ?, ?) ON CONFLICT(id, part) DO UPDATE SET snapshot = excluded.snapshot WHERE snapshot != excluded.snapshot",
        id,
        part++,
        encoded.slice(start, end),
      );
      start = end;
    }
    this.sql.exec(
      "DELETE FROM realtime_socket_chunks WHERE id = ? AND part >= ?",
      id,
      part,
    );
  }

  remove(id: string): void {
    this.sql.exec("DELETE FROM realtime_socket_chunks WHERE id = ?", id);
  }

  prune(liveIds: ReadonlySet<string>): void {
    for (const row of this.sql.exec<{ id: string }>(
      "SELECT DISTINCT id FROM realtime_socket_chunks",
    )) {
      if (!liveIds.has(row.id)) this.remove(row.id);
    }
  }
}
