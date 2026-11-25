import {
  bigint,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * A user's authenticator (TOTP, RFC 6238) for two-factor sign-in.
 *
 * Login is a signature by the identity key; this row adds a second factor the
 * key alone cannot answer. It is server-enforced product state, outside the
 * signed access plane.
 *
 * Columns:
 * - `userId`: The user; one authenticator per user.
 * - `secretCiphertext`: The TOTP secret, sealed with AES-256-GCM under a key
 *   the API derives from `TWO_FACTOR_SECRET_KEY` and bound to `userId`, so a
 *   database read alone cannot produce codes.
 * - `enabledAt`: When a code from the secret was first confirmed and sign-in
 *   began asking for one. Null while setup is pending; a pending row is
 *   replaced by the next setup and ignored at sign-in.
 * - `lastUsedStep`: The 30-second time step of the last accepted code. A code
 *   from that step or an earlier one is refused, so an observed code cannot be
 *   replayed.
 * - `failedAttempts` / `lockedUntil`: Consecutive wrong codes and the lockout
 *   they started. Only the key holder reaches code checks.
 * - `createdAt` / `updatedAt`: Server-side row timestamps.
 */
export const userTwoFactor = pgTable("user_two_factor", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretCiphertext: text("secret_ciphertext").notNull(),
  enabledAt: timestamp("enabled_at"),
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
  failedAttempts: integer("failed_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Unused single-use recovery codes for a user's two-factor sign-in.
 *
 * Only HMAC-SHA-256 hashes are stored, keyed by `TWO_FACTOR_SECRET_KEY` and
 * bound to the user, so a database read alone cannot test guesses; the codes
 * themselves are shown once. Using
 * a code deletes its row, and turning two-factor off or replacing the codes
 * deletes them all.
 *
 * Columns:
 * - `userId`: The user the code belongs to.
 * - `codeHash`: Lowercase hex SHA-256 of the normalized code.
 * - `createdAt`: When the code was issued.
 */
export const userTwoFactorRecoveryCodes = pgTable(
  "user_two_factor_recovery_codes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.codeHash] })],
);
