# Audit Logging Procedure (NIST SP 800-53)

<!-- COMPLIANCE_SENTINEL: TL-NAUDT-001 | policy=compliance/NIST.SP.800-53/policies/02-audit-logging-policy.md | procedure=compliance/NIST.SP.800-53/procedures/02-audit-logging-procedure.md | control=nginx-access-logging -->
<!-- COMPLIANCE_SENTINEL: TL-NAUDT-002 | policy=compliance/NIST.SP.800-53/policies/02-audit-logging-policy.md | procedure=compliance/NIST.SP.800-53/procedures/02-audit-logging-procedure.md | control=journald-retention -->
<!-- COMPLIANCE_SENTINEL: TL-NAUDT-003 | policy=compliance/NIST.SP.800-53/policies/02-audit-logging-policy.md | procedure=compliance/NIST.SP.800-53/procedures/02-audit-logging-procedure.md | control=nginx-log-rotation -->
<!-- COMPLIANCE_SENTINEL: TL-NAUDT-004 | policy=compliance/NIST.SP.800-53/policies/02-audit-logging-policy.md | procedure=compliance/NIST.SP.800-53/procedures/02-audit-logging-procedure.md | control=audit-log-archive -->

## Frequency

- Execute at least quarterly.
- Execute after any infrastructure change that affects logging configuration.
- Execute after any Ansible playbook deployment that includes logging templates.

## Procedure Steps

### AU-2/AU-12: Event Logging Verification

1. Verify nginx logging configuration is deployed with audit_combined format.
2. Verify systemd journal is configured to capture application logs.

### AU-3: Audit Record Content Verification

1. Sample nginx access logs to verify required fields are present (IP, timestamp, request, status, timing, SSL, request_id).
2. Sample journald entries to verify event context is captured.

### AU-4: Storage Capacity Verification

1. Verify journald retention configuration is deployed with storage limits.
2. Verify logrotate configuration is deployed for nginx logs.
3. Check current disk usage for log storage.

### AU-9: Audit Information Protection Verification

1. Verify log files have appropriate permissions (root-owned, restricted).
2. Verify archive directory has appropriate permissions.

### AU-11: Retention Verification

1. Verify operational logs are available for the past 90 days.
2. Verify audit archive timer is enabled and running.
3. Sample archived logs if available.

## Verification Commands

```bash
# AU-2/AU-12: Verify nginx logging configuration
cat /etc/nginx/conf.d/logging.conf
nginx -T 2>/dev/null | grep -A5 'log_format audit_combined'

# AU-4/AU-11: Verify journald retention configuration
cat /etc/systemd/journald.conf.d/compliance.conf
journalctl --disk-usage

# AU-4: Verify logrotate configuration
cat /etc/logrotate.d/nginx

# AU-11: Verify archive timer status
systemctl status audit-log-archive.timer
systemctl list-timers audit-log-archive.timer

# AU-9: Verify log file permissions
ls -la /var/log/nginx/
ls -la /var/archive/audit-logs/

# AU-3: Sample recent nginx access log entries (verify fields)
tail -5 /var/log/nginx/access.log

# AU-2: Sample recent journald entries
journalctl -n 10 --no-pager

# AU-4: Check disk usage
df -h /var/log /var/archive
```

## Evidence Template

- Review date:
- Reviewer:
- Ansible playbook commit SHA:
- NIST Controls verified: AU-2, AU-3, AU-4, AU-9, AU-11, AU-12
- Sentinels verified: `TL-NAUDT-001`, `TL-NAUDT-002`, `TL-NAUDT-003`, `TL-NAUDT-004`
- Verification commands run:
- Configuration state summary:
- Log sample verification (AU-3 fields present):
- Storage capacity status (AU-4):
- Exceptions or remediation tasks:
