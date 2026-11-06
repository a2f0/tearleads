import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Durable pins for user identity bundles.
 *
 * The first validated identity accepted for a user in a configured API trust
 * domain is inserted once. Later observations must match every suite, public
 * key, and fingerprint exactly; the persistence adapter never changes those
 * columns. `firstSeenAt` records when the local trust decision was made and is
 * likewise immutable. `provenance` (`self`, `link`, or `observed`) records how
 * the pin was established; only `self` and `link` admit a user, and it only
 * rises. A table without it is an obsolete local database.
 *
 * Indexes:
 * - `(identityTrustDomain, userId)` is the primary key and scopes a user pin to
 *   the host-configured API authority that supplied it.
 * - `(identityTrustDomain, signingKeyFingerprint)` binds the reverse identity
 *   mapping durably, including across session recreation. There is no
 *   migration for a table that already violates it. Earlier builds pinned a
 *   registration's user id before the server confirmed it, so a device that
 *   ran one may hold two users on one key; deployments are greenfield, and
 *   such a device clears its local data, which recreates this table empty. A
 *   device that used an environment before a reset does the same (see
 *   docs/developer/greenfield-reset.md).
 */
export const trustedUserIdentityPins = sqliteTable(
  "trusted_user_identity_pins",
  {
    identityTrustDomain: text("identity_trust_domain").notNull(),
    userId: text("user_id").notNull(),
    formatVersion: integer("format_version").notNull(),
    signingSuite: text("signing_suite").notNull(),
    signingPublicKey: text("signing_public_key").notNull(),
    signingKeyFingerprint: text("signing_key_fingerprint").notNull(),
    encapsulationSuite: text("encapsulation_suite").notNull(),
    encapsulationPublicKey: text("encapsulation_public_key").notNull(),
    encapsulationKeyFingerprint: text(
      "encapsulation_key_fingerprint",
    ).notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    provenance: text("provenance", {
      enum: ["self", "link", "observed"],
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identityTrustDomain, table.userId],
    }),
    uniqueIndex("trusted_user_identity_pins_domain_signing_fingerprint_idx").on(
      table.identityTrustDomain,
      table.signingKeyFingerprint,
    ),
  ],
);

export const trustedUserIdentityPinTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(trustedUserIdentityPins),
    requiredColumns: ["provenance"],
  },
];
