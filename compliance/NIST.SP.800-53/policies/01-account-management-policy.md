# Account Management Policy (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-NACCT-001 | policy=compliance/NIST.SP.800-53/policies/01-account-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/01-account-management-procedure.md | control=account-provisioning-authenticator-baseline -->
<!-- COMPLIANCE_SENTINEL: TL-NACCT-002 | policy=compliance/NIST.SP.800-53/policies/01-account-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/01-account-management-procedure.md | control=account-disable-attribution -->
<!-- COMPLIANCE_SENTINEL: TL-NACCT-003 | policy=compliance/NIST.SP.800-53/policies/01-account-management-policy.md | procedure=compliance/NIST.SP.800-53/procedures/01-account-management-procedure.md | control=access-review-auditability -->

## Purpose

Define mandatory account lifecycle controls aligned to NIST SP 800-53 Rev. 5 access, identity, and audit control families.

## Scope

1. User and administrator accounts for production and regulated systems.
2. Service accounts and machine identities used by platform integrations.
3. Account provisioning, role modification, disablement, and deletion-mark workflows.
4. Account review, evidence retention, and exception management activities.

## Policy Control Index

1. `N-AM-01` Account provisioning and authenticator baseline (`TL-NACCT-001`).
2. `N-AM-02` Attributable disablement and deprovisioning (`TL-NACCT-002`).
3. `N-AM-03` Account lifecycle audit records and recurring review (`TL-NACCT-003`).
4. `N-AM-04` Role-based least privilege and separation-of-duties expectations.
5. `N-AM-05` Privileged account governance and emergency access workflow.
6. `N-AM-06` Time-bound exception handling with compensating controls.

## Roles and Responsibilities

1. Security Owner approves this policy and reviews exception risk acceptance.
2. Engineering leads implement and validate technical controls.
3. Administrators execute approved account lifecycle actions and document approvals.
4. Compliance owners retain assessment evidence and remediation records.

## Policy Statements

1. Account provisioning must require documented approval, unique identity association, and credential baseline enforcement (`N-AM-01`, `TL-NACCT-001`).
2. Role assignments must enforce least privilege and consider separation-of-duties requirements (`N-AM-04`).
3. Account disablement and deletion-mark actions must capture actor and timestamp fields to preserve accountability (`N-AM-02`, `TL-NACCT-002`).
4. Termination and urgent risk-driven deprovisioning actions must be completed by end of business day on the trigger date (`N-AM-02`, `TL-NACCT-002`).
5. Privileged account assignment must be formally approved and reviewed at least quarterly (`N-AM-05`, `TL-NACCT-003`).
6. Account lifecycle events must be logged and retained as auditable evidence for create, modify, disable, and delete-mark actions (`N-AM-03`, `TL-NACCT-003`).
7. Emergency access must follow a documented workflow with next-business-day review and remediation tracking (`N-AM-05`).
8. Exceptions require Security Owner approval, compensating controls, and expiration within 90 days (`N-AM-06`).

## Control Baselines

1. Implemented baseline control: account registration credential enforcement and identity checks (`TL-NACCT-001`).
2. Implemented baseline control: attributable disablement and deletion-mark actions, including session revocation (`TL-NACCT-002`).
3. Implemented baseline control: account lifecycle logging plus quarterly review evidence handling (`TL-NACCT-003`).

## Framework Mapping

| Sentinel | NIST SP 800-53 | SOC2 Crosswalk | Control Outcome |
| --- | --- | --- | --- |
| `TL-NACCT-001` | AC-2, IA-2, IA-5 | CC6.2, CC6.3 | Account provisioning and authenticator baseline controls are enforced. |
| `TL-NACCT-002` | AC-2, AC-6, AU-3, PS-4 | CC6.2, CC7.2 | Disablement and deprovisioning actions are attributable and timely. |
| `TL-NACCT-003` | AU-2, AU-6, AC-2(7) | CC4.1, CC7.1 | Account lifecycle events are logged and reviewed on a recurring cadence. |
