# Account Management Policy (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-HACCT-001 | policy=compliance/HIPAA/policies/01-account-management-policy.md | procedure=compliance/HIPAA/procedures/01-account-management-procedure.md | control=unique-user-identification -->
<!-- COMPLIANCE_SENTINEL: TL-HACCT-002 | policy=compliance/HIPAA/policies/01-account-management-policy.md | procedure=compliance/HIPAA/procedures/01-account-management-procedure.md | control=timely-access-change -->
<!-- COMPLIANCE_SENTINEL: TL-HACCT-003 | policy=compliance/HIPAA/policies/01-account-management-policy.md | procedure=compliance/HIPAA/procedures/01-account-management-procedure.md | control=access-review-auditability -->

## Purpose

Define mandatory account lifecycle controls to protect ePHI and enforce HIPAA Security Rule access and accountability requirements.

## Scope

1. Workforce user accounts for systems that create, process, store, or transmit ePHI.
2. Privileged administrative accounts with access to ePHI systems.
3. Service accounts and automation identities used in production environments.
4. Account provisioning, modification, disablement, and deletion-mark workflows.
5. Access review evidence, exception handling, and remediation tracking.

## Policy Control Index

1. `H-AM-01` Unique user identification and account ownership (`TL-HACCT-001`).
2. `H-AM-02` Timely provisioning, modification, and deprovisioning (`TL-HACCT-002`).
3. `H-AM-03` Account lifecycle logging and quarterly access reviews (`TL-HACCT-003`).
4. `H-AM-04` Minimum necessary and least-privilege role assignment.
5. `H-AM-05` Privileged access hardening and segregation expectations.
6. `H-AM-06` Emergency access workflow and post-event review.
7. `H-AM-07` Exception approvals with compensating controls and expiry.

## Roles and Responsibilities

1. Security Officer owns this policy and approves exceptions and compensating controls.
2. Engineering leads implement technical controls and retain enforcement evidence.
3. Administrators execute account lifecycle actions with approved change records.
4. Compliance owners maintain evidence packages and verify remediation completion.

## Policy Statements

1. Every workforce and privileged user with ePHI access must have a unique user identifier and a documented account owner (`H-AM-01`, `TL-HACCT-001`).
2. Access provisioning and privilege changes must be approved and documented before implementation, except for emergency break-glass actions (`H-AM-02`, `TL-HACCT-002`).
3. Termination-driven deprovisioning and urgent disablement actions must be completed by end of business day on the trigger date (`H-AM-02`, `TL-HACCT-002`).
4. Access permissions must follow minimum necessary and least-privilege principles for each job function (`H-AM-04`).
5. Privileged administrative access must be restricted to approved personnel and should use separate admin and standard identities where feasible (`H-AM-05`).
6. Emergency access must follow a defined workflow that captures requestor, approver, reason, and post-event review evidence within one business day (`H-AM-06`).
7. Account lifecycle events (create, modify, disable, delete-mark, emergency access) must be logged with actor, target, timestamp, and outcome (`H-AM-03`, `TL-HACCT-003`).
8. Access reviews for privileged and ePHI-high-risk roles must occur at least quarterly, with revocations tracked to closure (`H-AM-03`, `TL-HACCT-003`).
9. Policy exceptions require written approval, documented compensating controls, and expiration within 90 days (`H-AM-07`).

## Control Baselines

1. Baseline control: unique identity and credential quality enforcement in registration and auth flows (`TL-HACCT-001`).
2. Baseline control: attributable disable and deletion-mark actions for administrative workflows (`TL-HACCT-002`).
3. Baseline control: auditability of account lifecycle events and periodic review evidence (`TL-HACCT-003`).

## Framework Mapping

| Sentinel | HIPAA Citation | NIST SP 800-53 Crosswalk | Control Outcome |
| --- | --- | --- | --- |
| `TL-HACCT-001` | 164.312(a)(2)(i), 164.308(a)(3) | AC-2, IA-2, IA-5 | Unique user identification and credential controls are enforced. |
| `TL-HACCT-002` | 164.308(a)(3)(ii)(C), 164.308(a)(4) | AC-2, AC-6, PS-4 | Access changes and deprovisioning are attributable and timely. |
| `TL-HACCT-003` | 164.312(b), 164.316(b) | AU-2, AU-3, AC-2(7) | Account lifecycle events are auditable and reviewable. |
