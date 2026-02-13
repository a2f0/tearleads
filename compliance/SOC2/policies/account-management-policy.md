# Account Management Policy (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/account-management-policy.md | procedure=compliance/SOC2/procedures/account-management-procedure.md | control=password-complexity -->
<!-- COMPLIANCE_SENTINEL: TL-ACCT-002 | policy=compliance/SOC2/policies/account-management-policy.md | procedure=compliance/SOC2/procedures/account-management-procedure.md | control=account-disable-attribution -->
<!-- COMPLIANCE_SENTINEL: TL-ACCT-003 | policy=compliance/SOC2/policies/account-management-policy.md | procedure=compliance/SOC2/procedures/account-management-procedure.md | control=deletion-marking-attribution -->

## Purpose

Define mandatory controls for account lifecycle and credential quality, and map those controls to system-enforced technical implementations.

## Scope

- User registration and credential setup
- Administrative account disable actions
- Administrative account deletion-marking actions

## Policy Statements

1. Password complexity must be enforced at account registration with a minimum of 12 characters and required uppercase, lowercase, number, and symbol composition.
2. Account disable actions must record both actor (`disabled_by`) and timestamp (`disabled_at`).
3. Account deletion-marking actions must record both actor (`marked_for_deletion_by`) and timestamp (`marked_for_deletion_at`).
4. Administrative disablement must revoke active user sessions.

## Control Baselines

- Password baseline for initial implementation: minimum length of 12 characters plus uppercase, lowercase, number, and symbol (`TL-ACCT-001`).
- Disablement baseline: actor + timestamp capture and session revocation (`TL-ACCT-002`).
- Deletion-marking attribution baseline: actor + timestamp capture (`TL-ACCT-003`).

## Framework Mapping

| Sentinel | SOC2 TSC | NIST SP 800-53 | Control Outcome |
| --- | --- | --- | --- |
| `TL-ACCT-001` | CC6.2, CC6.3 | IA-5, AC-2 | Password quality policy is enforced in account creation path. |
| `TL-ACCT-002` | CC6.2, CC7.2 | AC-2, AU-3 | Disable actions are attributable and auditable. |
| `TL-ACCT-003` | CC6.2, CC7.2 | AC-2, AU-3 | Deletion-marking actions are attributable and auditable. |
