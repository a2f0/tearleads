-- A principal payload record keeps only its ciphertext: the signed state's
-- payloadCiphertextHash commits to it and the cipher suite is fixed (#2903 P23).
ALTER TABLE "principal_state_payloads" DROP COLUMN "cipher_suite";--> statement-breakpoint
ALTER TABLE "principal_state_payloads" DROP COLUMN "ciphertext_hash";