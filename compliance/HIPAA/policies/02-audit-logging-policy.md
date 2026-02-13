# Audit Logging Policy (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-HAUDT-001 | policy=compliance/HIPAA/policies/02-audit-logging-policy.md | procedure=compliance/HIPAA/procedures/02-audit-logging-procedure.md | control=nginx-access-logging -->
<!-- COMPLIANCE_SENTINEL: TL-HAUDT-002 | policy=compliance/HIPAA/policies/02-audit-logging-policy.md | procedure=compliance/HIPAA/procedures/02-audit-logging-procedure.md | control=journald-retention -->
<!-- COMPLIANCE_SENTINEL: TL-HAUDT-003 | policy=compliance/HIPAA/policies/02-audit-logging-policy.md | procedure=compliance/HIPAA/procedures/02-audit-logging-procedure.md | control=nginx-log-rotation -->
<!-- COMPLIANCE_SENTINEL: TL-HAUDT-004 | policy=compliance/HIPAA/policies/02-audit-logging-policy.md | procedure=compliance/HIPAA/procedures/02-audit-logging-procedure.md | control=audit-log-archive -->

## Purpose

Define mandatory controls for audit logging, log retention, and log protection aligned with HIPAA Security Rule requirements. This policy establishes requirements for capturing, storing, and archiving audit records to support detection of unauthorized ePHI access and maintenance of required documentation.

## Regulatory Authority

- **45 CFR 164.312(b)** - Audit Controls (Technical Safeguard - Required)
- **45 CFR 164.308(a)(1)(ii)(D)** - Information System Activity Review (Administrative Safeguard)
- **45 CFR 164.316(b)** - Documentation (6-year retention requirement)

## Scope

1. Web server (nginx) access and error logging for ePHI system access.
2. Application service logging via systemd journal.
3. Operational log retention (90 days) for activity review.
4. Long-term log archival (6 years) for documentation compliance.
5. Log rotation and storage management.

## Policy Control Index

1. `AL-01` Audit control mechanisms for ePHI access (164.312(b)) (`TL-HAUDT-001`).
2. `AL-02` Information system activity logging (164.308(a)(1)(ii)(D)) (`TL-HAUDT-001`, `TL-HAUDT-002`).
3. `AL-03` Log storage and rotation management (`TL-HAUDT-002`, `TL-HAUDT-003`).
4. `AL-04` Documentation retention (164.316(b)) (`TL-HAUDT-004`).
5. `AL-05` Log protection and access controls.
6. `AL-06` Information system activity review procedures.

## Roles and Responsibilities

1. Privacy Officer/Security Officer maintains this policy, approves exceptions, and reviews control evidence.
2. Infrastructure leads implement and maintain logging configuration in deployment automation.
3. Operations personnel monitor log storage capacity and archive integrity.
4. Compliance owners retain evidence artifacts and conduct periodic activity reviews.

## Policy Statements

### 164.312(b) Audit Controls

- Hardware, software, and procedural mechanisms must be implemented to record and examine activity in information systems that contain or use ePHI (`AL-01`, `TL-HAUDT-001`).
- Web server access logs must capture: client IP, timestamp (ISO8601), request details, response status, request timing, SSL protocol/cipher, and unique request ID (`AL-01`, `TL-HAUDT-001`).
- Application and system logs must be directed to systemd journal with persistent storage enabled (`AL-02`, `TL-HAUDT-002`).

### 164.308(a)(1)(ii)(D) Information System Activity Review

- Audit logs must be sufficient to support regular review of records of information system activity, such as audit logs, access reports, and security incident tracking reports (`AL-02`, `TL-HAUDT-001`, `TL-HAUDT-002`).
- Operational log retention must be maintained for a minimum of 90 days to support activity review (`AL-03`, `TL-HAUDT-002`).

### 164.316(b) Documentation

- Documentation, including audit logs and policies, must be retained for 6 years from the date of creation or the date when it was last in effect, whichever is later (`AL-04`, `TL-HAUDT-004`).
- Logs beyond operational retention must be archived for long-term compliance evidence (`AL-04`, `TL-HAUDT-004`).

### Log Protection

- Log files and archives must be protected with appropriate file permissions (root-owned, restricted read access) (`AL-05`).
- Log storage capacity must be monitored to prevent log loss due to disk exhaustion (`AL-05`).
- Log rotation must be configured to manage storage while preserving logs within the retention period (`AL-03`, `TL-HAUDT-003`).

### Activity Review

- Security-relevant log events must be reviewed periodically for anomalies and potential security incidents (`AL-06`).

## Control Baselines

1. Implemented baseline control: nginx audit log format with audit-grade fields (`TL-HAUDT-001`).
2. Implemented baseline control: journald 90-day persistent retention (`TL-HAUDT-002`).
3. Implemented baseline control: nginx log rotation with 90-day retention (`TL-HAUDT-003`).
4. Implemented baseline control: monthly log archive with 6-year retention (`TL-HAUDT-004`).
5. Program baseline expansion target: implement automated anomaly detection and alerting.

## Framework Mapping

| Sentinel | HIPAA Security Rule | NIST SP 800-53 | Control Outcome |
| --- | --- | --- | --- |
| `TL-HAUDT-001` | 164.312(b), 164.308(a)(1)(ii)(D) | AU-2, AU-3, AU-12 | Web server access events are logged with audit-grade detail. |
| `TL-HAUDT-002` | 164.312(b), 164.308(a)(1)(ii)(D) | AU-4, AU-11 | System logs are retained for 90 days in persistent storage. |
| `TL-HAUDT-003` | 164.312(b) | AU-4, AU-9 | Log rotation manages storage while preserving audit records. |
| `TL-HAUDT-004` | 164.316(b) | AU-9, AU-11 | Logs are archived for 6-year documentation retention. |
