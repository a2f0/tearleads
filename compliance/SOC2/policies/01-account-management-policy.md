# Account Management Policy (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity -->
<!-- COMPLIANCE_SENTINEL: TL-ACCT-002 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=account-disable-attribution -->
<!-- COMPLIANCE_SENTINEL: TL-ACCT-003 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=deletion-marking-attribution -->

## Purpose

Define mandatory controls for account lifecycle governance, credential quality, and access accountability. This policy establishes minimum account-management requirements and maps currently implemented controls to technical enforcement points.

## Scope

1. User registration and credential setup.
2. Administrative account disable actions.
3. Administrative account deletion-marking actions.
4. Privileged account assignment and review workflows.
5. Account lifecycle evidence and exception handling.

## Policy Control Index

1. `AM-01` Credential complexity baseline (`TL-ACCT-001`).
2. `AM-02` Disablement attribution and session revocation (`TL-ACCT-002`).
3. `AM-03` Deletion-marking attribution (`TL-ACCT-003`).
4. `AM-04` Unique account ownership and approved provisioning.
5. `AM-05` Role-based least-privilege administration.
6. `AM-06` Joiner/mover/leaver lifecycle timing requirements.
7. `AM-07` Privileged access hardening requirements.
8. `AM-08` Quarterly access review requirements.
9. `AM-09` Account lifecycle logging and evidence retention.
10. `AM-10` Time-bound exception and risk acceptance requirements.

## Roles and Responsibilities

1. Security Owner maintains this policy, approves exceptions, and reviews control evidence.
2. Engineering leads implement and maintain enforcement in application and infrastructure systems.
3. Administrators execute provisioning, privilege changes, disablement, and deletion-marking under approved workflows.
4. Compliance owners retain evidence artifacts and track remediation for policy exceptions.

## Policy Statements

1. Password complexity must be enforced at account registration with a minimum of 12 characters and required uppercase, lowercase, number, and symbol composition (`AM-01`, `TL-ACCT-001`).
2. Account disable actions must record both actor (`disabled_by`) and timestamp (`disabled_at`) (`AM-02`, `TL-ACCT-002`).
3. Account deletion-marking actions must record both actor (`marked_for_deletion_by`) and timestamp (`marked_for_deletion_at`) (`AM-03`, `TL-ACCT-003`).
4. Administrative disablement must revoke active user sessions (`AM-02`, `TL-ACCT-002`).
5. Each account must be tied to a unique person or service owner; shared human accounts are prohibited (`AM-04`).
6. Administrative and privileged access must be granted through approved role-based workflows and limited to least privilege (`AM-05`).
7. Provisioning and role-change requests must have documented approval; termination and urgent disablement actions must be executed within the same business day when triggered (`AM-06`).
8. Privileged users must use strong authentication controls supported by the platform and should use separate admin and standard identities where feasible (`AM-07`).
9. Privileged and high-risk account assignments must be reviewed at least quarterly, with revocations and remediation tracked to closure (`AM-08`).
10. Account lifecycle events (create, role change, disable, delete-mark) must be logged with actor, target, timestamp, and outcome and retained as compliance evidence (`AM-09`).
11. Policy exceptions require written Security Owner approval, defined compensating controls, and an expiration date not to exceed 90 days (`AM-10`).

## Control Baselines

1. Implemented baseline control: password complexity enforcement at registration (`TL-ACCT-001`).
2. Implemented baseline control: disablement attribution and session revocation (`TL-ACCT-002`).
3. Implemented baseline control: deletion-marking attribution (`TL-ACCT-003`).
4. Program baseline expansion target: enforce and evidence `AM-04` through `AM-10` through subsequent control-map updates.

## Framework Mapping

| Sentinel | SOC2 TSC | NIST SP 800-53 | Control Outcome |
| --- | --- | --- | --- |
| `TL-ACCT-001` | CC6.2, CC6.3 | IA-5, AC-2 | Password quality policy is enforced in account creation path. |
| `TL-ACCT-002` | CC6.2, CC7.2 | AC-2, AU-3 | Disable actions are attributable and auditable. |
| `TL-ACCT-003` | CC6.2, CC7.2 | AC-2, AU-3 | Deletion-marking actions are attributable and auditable. |
