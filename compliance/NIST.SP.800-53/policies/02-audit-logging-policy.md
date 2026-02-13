# Audit Logging Policy (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-NAUDT-001 | policy=compliance/NIST.SP.800-53/policies/02-audit-logging-policy.md | procedure=compliance/NIST.SP.800-53/procedures/02-audit-logging-procedure.md | control=nginx-access-logging -->
<!-- COMPLIANCE_SENTINEL: TL-NAUDT-002 | policy=compliance/NIST.SP.800-53/policies/02-audit-logging-policy.md | procedure=compliance/NIST.SP.800-53/procedures/02-audit-logging-procedure.md | control=journald-retention -->
<!-- COMPLIANCE_SENTINEL: TL-NAUDT-003 | policy=compliance/NIST.SP.800-53/policies/02-audit-logging-policy.md | procedure=compliance/NIST.SP.800-53/procedures/02-audit-logging-procedure.md | control=nginx-log-rotation -->
<!-- COMPLIANCE_SENTINEL: TL-NAUDT-004 | policy=compliance/NIST.SP.800-53/policies/02-audit-logging-policy.md | procedure=compliance/NIST.SP.800-53/procedures/02-audit-logging-procedure.md | control=audit-log-archive -->

## Purpose

Define mandatory controls for audit logging, log retention, and log protection aligned with NIST SP 800-53 Revision 5 Audit and Accountability (AU) family requirements. This policy establishes requirements for capturing, storing, and archiving audit records across application and infrastructure components.

## Scope

1. Web server (nginx) access and error logging (AU-2, AU-3, AU-12).
2. Application service logging via systemd journal (AU-2, AU-12).
3. Audit log storage capacity management (AU-4).
4. Audit record retention (AU-11).
5. Protection of audit information (AU-9).
6. Log rotation and storage management.

## Policy Control Index

1. `AL-01` Event logging configuration (AU-2, AU-12) (`TL-NAUDT-001`).
2. `AL-02` Audit record content requirements (AU-3) (`TL-NAUDT-001`).
3. `AL-03` Audit storage capacity allocation (AU-4) (`TL-NAUDT-002`, `TL-NAUDT-003`).
4. `AL-04` Protection of audit information (AU-9) (`TL-NAUDT-003`, `TL-NAUDT-004`).
5. `AL-05` Audit record retention (AU-11) (`TL-NAUDT-002`, `TL-NAUDT-004`).
6. `AL-06` Audit record review and analysis (AU-6).

## Roles and Responsibilities

1. Security Owner maintains this policy, approves exceptions, and reviews control evidence.
2. Infrastructure leads implement and maintain logging configuration in deployment automation.
3. Operations personnel monitor audit storage capacity and archive integrity.
4. Compliance owners retain evidence artifacts and conduct periodic audit reviews.

## Policy Statements

### AU-2: Event Logging

- The system must identify events that require logging, including: user authentication, access to protected resources, administrative actions, and security-relevant system events (`AL-01`, `TL-NAUDT-001`).

### AU-3: Content of Audit Records

- Audit records must contain: what type of event occurred, when the event occurred, where the event occurred, the source of the event, the outcome of the event, and the identity of individuals or subjects associated with the event (`AL-02`, `TL-NAUDT-001`).
- Web server access logs must include: client IP, timestamp (ISO8601), request details, response status, request timing, SSL protocol/cipher, and unique request ID (`AL-02`, `TL-NAUDT-001`).

### AU-4: Audit Log Storage Capacity

- Sufficient audit log storage capacity must be allocated to accommodate the 90-day operational retention requirement (`AL-03`, `TL-NAUDT-002`).
- Log rotation must be configured to manage storage while preserving audit records within the retention period (`AL-03`, `TL-NAUDT-003`).

### AU-9: Protection of Audit Information

- Audit information and audit logging tools must be protected from unauthorized access, modification, and deletion (`AL-04`, `TL-NAUDT-003`, `TL-NAUDT-004`).
- Log files and archives must be protected with appropriate file permissions (root-owned, restricted read access) (`AL-04`).

### AU-11: Audit Record Retention

- Audit records must be retained for 90 days for operational purposes (`AL-05`, `TL-NAUDT-002`).
- Audit records must be archived for 6 years to support audit, legal, and compliance requirements (`AL-05`, `TL-NAUDT-004`).

### AU-12: Audit Record Generation

- The system must generate audit records containing information that establishes the nature, source, time, and outcome of events (`AL-01`, `TL-NAUDT-001`).

## Control Baselines

1. Implemented baseline control: nginx audit log format with AU-3 compliant fields (`TL-NAUDT-001`).
2. Implemented baseline control: journald 90-day persistent retention (`TL-NAUDT-002`).
3. Implemented baseline control: nginx log rotation with 90-day retention (`TL-NAUDT-003`).
4. Implemented baseline control: monthly log archive with 6-year retention (`TL-NAUDT-004`).
5. Program baseline expansion target: implement AU-5 (response to audit logging failures) and AU-6 (automated audit review).

## Framework Mapping

| Sentinel | NIST SP 800-53 | SOC2 TSC | Control Outcome |
| --- | --- | --- | --- |
| `TL-NAUDT-001` | AU-2, AU-3, AU-12 | CC7.1, CC7.2 | Web server access events are logged with AU-3 compliant detail. |
| `TL-NAUDT-002` | AU-4, AU-11 | CC7.2, CC4.1 | System logs are retained for 90 days in persistent storage. |
| `TL-NAUDT-003` | AU-4, AU-9 | CC7.1 | Log rotation manages storage while protecting audit records. |
| `TL-NAUDT-004` | AU-9, AU-11 | CC4.1, CC7.2 | Logs are archived for long-term retention (6 years). |
