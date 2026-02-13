# Audit Logging Procedure (HIPAA)

<!-- COMPLIANCE_SENTINEL: TL-HAUDT-001 | policy=compliance/HIPAA/policies/02-audit-logging-policy.md | procedure=compliance/HIPAA/procedures/02-audit-logging-procedure.md | control=nginx-access-logging -->
<!-- COMPLIANCE_SENTINEL: TL-HAUDT-002 | policy=compliance/HIPAA/policies/02-audit-logging-policy.md | procedure=compliance/HIPAA/procedures/02-audit-logging-procedure.md | control=journald-retention -->
<!-- COMPLIANCE_SENTINEL: TL-HAUDT-003 | policy=compliance/HIPAA/policies/02-audit-logging-policy.md | procedure=compliance/HIPAA/procedures/02-audit-logging-procedure.md | control=nginx-log-rotation -->
<!-- COMPLIANCE_SENTINEL: TL-HAUDT-004 | policy=compliance/HIPAA/policies/02-audit-logging-policy.md | procedure=compliance/HIPAA/procedures/02-audit-logging-procedure.md | control=audit-log-archive -->

## Frequency

- Execute at least quarterly.
- Execute after any infrastructure change that affects logging configuration.
- Execute after any Ansible playbook deployment that includes logging templates.

## Procedure Steps

### 164.312(b) Audit Controls Verification

1. Verify nginx logging configuration is deployed with audit_combined format.
2. Verify systemd journal is configured to capture application logs.
3. Verify log files capture sufficient detail for activity examination.

### 164.308(a)(1)(ii)(D) Activity Review Capability Verification

1. Sample nginx access logs to verify required fields are present.
2. Sample journald entries to verify application events are captured.
3. Verify logs are accessible for review by authorized personnel.

### 164.316(b) Documentation Retention Verification

1. Verify journald retention configuration is deployed with 90-day operational retention.
2. Verify audit archive timer is enabled and running.
3. Verify archive directory exists and contains archived logs (if applicable).
4. Verify archive retention is configured for 6 years.

### Log Protection Verification

1. Verify log files have appropriate permissions (root-owned, restricted).
2. Verify archive directory has appropriate permissions.
3. Check current disk usage for log storage.

## Verification Commands

```bash
# 164.312(b): Verify nginx logging configuration
cat /etc/nginx/conf.d/logging.conf
nginx -T 2>/dev/null | grep -A5 'log_format audit_combined'

# 164.312(b): Verify journald retention configuration
cat /etc/systemd/journald.conf.d/compliance.conf
journalctl --disk-usage

# Verify logrotate configuration
cat /etc/logrotate.d/nginx

# 164.316(b): Verify archive timer status
systemctl status audit-log-archive.timer
systemctl list-timers audit-log-archive.timer

# Verify log file permissions
ls -la /var/log/nginx/
ls -la /var/archive/audit-logs/

# 164.308(a)(1)(ii)(D): Sample recent nginx access log entries
tail -5 /var/log/nginx/access.log

# Sample recent journald entries
journalctl -n 10 --no-pager

# Check disk usage
df -h /var/log /var/archive
```

## Evidence Template

- Review date:
- Reviewer:
- Ansible playbook commit SHA:
- HIPAA Controls verified: 164.312(b), 164.308(a)(1)(ii)(D), 164.316(b)
- Sentinels verified: `TL-HAUDT-001`, `TL-HAUDT-002`, `TL-HAUDT-003`, `TL-HAUDT-004`
- Verification commands run:
- Configuration state summary:
- Log sample verification:
- Archive status (164.316(b) compliance):
- Exceptions or remediation tasks:
