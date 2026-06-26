import { index, integer, pgTable, text, timestamp, uuid } from "./columns";
import type { AccountStatus } from "./shared";

/**
 * Registered human users and their long-lived public key material.
 *
 * A user row is created during user registration. The access workflows
 * load this table to verify signatures, encrypt user-recipient envelopes, and
 * resolve the user's default personal organization/root container context.
 * Private keys never live in this table; only public keys and fingerprints are
 * stored.
 *
 * Columns:
 * - `id`: Stable server-side user id.
 * - `fingerprint`: Unique signing key fingerprint used by authentication and
 *   signature verification.
 * - `signingPublicKey`: Public signing key bytes, base64 encoded.
 * - `encapsulationPublicKey`: Public KEM/encapsulation key bytes, base64
 *   encoded. Writers use this when wrapping material directly to the user.
 * - `encapsulationKeyFingerprint`: Fingerprint of `encapsulationPublicKey`.
 *   Recipient-envelope verification compares submitted fingerprints to this
 *   value.
 * - `defaultOrganizationId`: Personal/default organization created during
 *   registration and used as the user's initial organization boundary.
 * - `accountStatus`: Lifecycle state for paid-account enforcement. Trialing
 *   and active accounts can use paid sync/org routes; disabled, deleting, and
 *   purged accounts cannot.
 * - `trialEndsAt`: Server-side timestamp when the initial free trial ends.
 * - `disabledAt` / `purgeAfter`: Set when the account becomes disabled. The
 *   purge job may delete remote account data after `purgeAfter`.
 * - `purgeStartedAt` / `purgedAt`: Purge job progress markers. The user/key row
 *   remains after purge so a later payment flow can reactivate the identity.
 * - `remoteDataEpoch`: Monotonic generation for server-side sync data. It
 *   increments after purge so clients can discard stale sync state.
 * - `createdAt`: Server-side registration timestamp.
 *
 * Indexes:
 * - `users_fingerprint_unique` enforces one signing key fingerprint per user
 *   and gives auth challenge verification an indexed `fingerprint` lookup.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fingerprint: text("fingerprint").notNull().unique(),
    signingPublicKey: text("signing_public_key").notNull(),
    encapsulationPublicKey: text("encapsulation_public_key").notNull(),
    encapsulationKeyFingerprint: text(
      "encapsulation_key_fingerprint",
    ).notNull(),
    defaultOrganizationId: uuid("default_organization_id").notNull(),
    accountStatus: text("account_status")
      .$type<AccountStatus>()
      .default("trialing")
      .notNull(),
    trialEndsAt: timestamp("trial_ends_at").defaultNow().notNull(),
    disabledAt: timestamp("disabled_at"),
    purgeAfter: timestamp("purge_after"),
    purgeStartedAt: timestamp("purge_started_at"),
    purgedAt: timestamp("purged_at"),
    remoteDataEpoch: integer("remote_data_epoch").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("users_trial_expiry_idx").on(
      table.accountStatus,
      table.trialEndsAt,
      table.id,
    ),
    index("users_purge_candidates_idx").on(
      table.accountStatus,
      table.purgeAfter,
      table.purgeStartedAt,
      table.id,
    ),
  ],
);
