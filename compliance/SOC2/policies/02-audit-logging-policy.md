# Audit Logging Policy (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-AUDT-001 | policy=compliance/SOC2/policies/02-audit-logging-policy.md | procedure=compliance/SOC2/procedures/02-audit-logging-procedure.md | control=nginx-access-logging -->
<!-- COMPLIANCE_SENTINEL: TL-AUDT-002 | policy=compliance/SOC2/policies/02-audit-logging-policy.md | procedure=compliance/SOC2/procedures/02-audit-logging-procedure.md | control=journald-retention -->
<!-- COMPLIANCE_SENTINEL: TL-AUDT-003 | policy=compliance/SOC2/policies/02-audit-logging-policy.md | procedure=compliance/SOC2/procedures/02-audit-logging-procedure.md | control=nginx-log-rotation -->
<!-- COMPLIANCE_SENTINEL: TL-AUDT-004 | policy=compliance/SOC2/policies/02-audit-logging-policy.md | procedure=compliance/SOC2/procedures/02-audit-logging-procedure.md | control=audit-log-archive -->

## Purpose

Define mandatory controls for audit logging, log retention, and log protection to support security monitoring, incident response, and compliance evidence. This policy establishes requirements for capturing, storing, and archiving audit records across application and infrastructure components.

## Scope

1. Web server (nginx) access and error logging.
2. Application service logging via systemd journal.
3. Operational log retention (90 days).
4. Long-term log archival for compliance evidence.
5. Log rotation and storage management.

## Policy Control Index

1. `AL-01` Web server access logging with audit-grade fields (`TL-AUDT-001`).
2. `AL-02` Systemd journal retention configuration (`TL-AUDT-002`).
3. `AL-03` Log rotation for operational storage management (`TL-AUDT-003`).
4. `AL-04` Long-term log archival for compliance retention (`TL-AUDT-004`).
5. `AL-05` Log protection and access controls.
6. `AL-06` Log review and monitoring procedures.

## Roles and Responsibilities

1. Security Owner maintains this policy, approves exceptions, and reviews control evidence.
2. Infrastructure leads implement and maintain logging configuration in deployment automation.
3. Operations personnel monitor log storage capacity and archive integrity.
4. Compliance owners retain evidence artifacts and conduct periodic log reviews.

## Policy Statements

1. Web server access logs must include: client IP, timestamp (ISO8601), request details, response status, request timing, SSL protocol/cipher, and unique request ID (`AL-01`, `TL-AUDT-001`).
2. Application and system logs must be directed to systemd journal with persistent storage enabled (`AL-02`, `TL-AUDT-002`).
3. Operational log retention must be maintained for a minimum of 90 days (`AL-02`, `TL-AUDT-002`).
4. Log rotation must be configured to manage storage while preserving logs within the retention period (`AL-03`, `TL-AUDT-003`).
5. Logs beyond operational retention must be archived for long-term compliance evidence (`AL-04`, `TL-AUDT-004`).
6. Long-term archives must be retained for a minimum of 6 years to support audit and legal requirements (`AL-04`, `TL-AUDT-004`).
7. Log files and archives must be protected with appropriate file permissions (root-owned, restricted read access) (`AL-05`).
8. Log storage capacity must be monitored to prevent log loss due to disk exhaustion (`AL-05`).
9. Security-relevant log events must be reviewed periodically for anomalies and incidents (`AL-06`).

## Control Baselines

1. Implemented baseline control: nginx audit log format with extended fields (`TL-AUDT-001`).
2. Implemented baseline control: journald 90-day persistent retention (`TL-AUDT-002`).
3. Implemented baseline control: nginx log rotation with 90-day retention (`TL-AUDT-003`).
4. Implemented baseline control: monthly log archive with 6-year retention (`TL-AUDT-004`).
5. Program baseline expansion target: implement centralized log aggregation and automated anomaly detection.

## Framework Mapping

| Sentinel | SOC2 TSC | NIST SP 800-53 | Control Outcome |
| --- | --- | --- | --- |
| `TL-AUDT-001` | CC7.1, CC7.2 | AU-2, AU-3, AU-12 | Web server access events are logged with audit-grade detail. |
| `TL-AUDT-002` | CC7.2, CC4.1 | AU-4, AU-11 | System logs are retained for 90 days in persistent storage. |
| `TL-AUDT-003` | CC7.1 | AU-4, AU-9 | Log rotation manages storage while preserving audit records. |
| `TL-AUDT-004` | CC4.1, CC7.2 | AU-9, AU-11 | Logs are archived for long-term compliance retention (6 years). |
