# Compliance Agent Instructions

This folder tracks policy, procedure, and technical control mappings for compliance frameworks.

## Sentinel Standard

- Sentinel IDs are stable and policy-scoped: `TL-<policy>-<3 digits>` (example: `TL-ACCT-001`).
- Reuse the same sentinel ID across all files that implement the same control.
- Use this payload format in comments:
  - `COMPLIANCE_SENTINEL: <ID> | policy=<policy-doc> | procedure=<procedure-doc> | control=<short-name>`

## Comment Syntax By File Type

- Markdown (`.md`): `<!-- COMPLIANCE_SENTINEL: TL-ACCT-001 | ... -->`
- TypeScript/TSX (`.ts`, `.tsx`): `// COMPLIANCE_SENTINEL: TL-ACCT-001 | ...`
- YAML/Shell/Python (`.yml`, `.yaml`, `.sh`, `.py`): `# COMPLIANCE_SENTINEL: TL-ACCT-001 | ...`
- SQL (`.sql`): `-- COMPLIANCE_SENTINEL: TL-ACCT-001 | ...`
- Jinja templates (`.j2`): `{# COMPLIANCE_SENTINEL: TL-ACCT-001 | ... #}`

## Required Wiring Steps

1. Define or update the policy statement under `compliance/<framework>/policies/`.
2. Define or update procedure steps under `compliance/<framework>/procedures/`.
3. Update the technical control map under `compliance/<framework>/technical-controls/`.
4. Add sentinel comments at implementation points and, when practical, at test evidence points.
5. Run targeted tests and capture the command set in the procedure evidence log.

## Preen Follow-Up

After wiring new controls, run relevant preen skills to keep mappings current:

- `preen-typescript` for TypeScript control integrity
- `preen-api-security` for auth/account-control checks
- `preen` for broader stale control cleanup
