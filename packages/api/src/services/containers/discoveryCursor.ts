import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import type { SyncWatermark } from "@tearleads/validators/response";

/** Keep the database-wide position private and bind continuation to the same
 * user, lane and timestamp. A legacy cursor or a different database replays
 * from the start, with the ordinary page bound. */
export function discoveryCursor(
  secret: string,
  scope: readonly [string, "containers" | "documents", string | null],
  requested: SyncWatermark | null,
) {
  const key = createHmac("sha256", secret)
    .update("tearleads.discovery-cursor.v1")
    .digest();
  const aad = (updatedAt: string) =>
    Buffer.from(JSON.stringify([...scope, updatedAt]));
  const open = () => {
    if (!requested || !/^d1\/[A-Za-z0-9_-]{138}$/.test(requested.id))
      return null;
    const bytes = Buffer.from(requested.id.slice(3), "base64url");
    try {
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      cipher.setAAD(aad(requested.updatedAt));
      cipher.setAuthTag(bytes.subarray(12, 28));
      const value = Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]);
      const [id, walPosition] = value.toString().trimStart().split(",");
      if (
        !id ||
        !walPosition ||
        !/^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/iu.test(walPosition)
      )
        return null;
      return { position: { updatedAt: requested.updatedAt, id }, walPosition };
    } catch {
      return null;
    }
  };
  const decoded = open();
  const position = decoded?.position ?? null;
  return {
    position,
    walPosition: decoded?.walPosition ?? null,
    seal(
      next: SyncWatermark | null,
      walPosition: string,
    ): SyncWatermark | null {
      if (next === position || !next) return requested;
      // Fixed-width position, UUID, and WAL location hide cross-lane activity.
      const input = `${next.id},${walPosition}`.padStart(75, " ");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(next.updatedAt));
      const encrypted = Buffer.concat([
        cipher.update(input, "utf8"),
        cipher.final(),
      ]);
      const token = Buffer.concat([
        iv,
        cipher.getAuthTag(),
        encrypted,
      ]).toString("base64url");
      return { updatedAt: next.updatedAt, id: `d1/${token}` };
    },
  };
}
