import { pgTable, text, timestamp, uuid } from "./columns";

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
 * - `createdAt`: Server-side registration timestamp.
 *
 * Indexes:
 * - `users_fingerprint_unique` enforces one signing key fingerprint per user
 *   and gives auth challenge verification an indexed `fingerprint` lookup.
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  signingPublicKey: text("signing_public_key").notNull(),
  encapsulationPublicKey: text("encapsulation_public_key").notNull(),
  encapsulationKeyFingerprint: text("encapsulation_key_fingerprint").notNull(),
  defaultOrganizationId: uuid("default_organization_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
