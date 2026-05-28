# Keying Projection Verification Internals

`../keyingProjectionVerification.ts` is the public client-side verifier facade
for server writer projections. Files in this folder hold internal helpers for
that facade.

- `readers.ts` decodes canonical wire records into crypto verification inputs.

Keep exported verifier functions and types on `../keyingProjectionVerification.ts`
so workflow and store layers do not import these internals directly.
