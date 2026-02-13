# Audit Logging Procedure (SOC2)

<!-- COMPLIANCE_SENTINEL: TL-AUDT-001 | policy=compliance/SOC2/policies/02-audit-logging-policy.md | procedure=compliance/SOC2/procedures/02-audit-logging-procedure.md | control=nginx-access-logging -->
<!-- COMPLIANCE_SENTINEL: TL-AUDT-002 | policy=compliance/SOC2/policies/02-audit-logging-policy.md | procedure=compliance/SOC2/procedures/02-audit-logging-procedure.md | control=journald-retention -->
<!-- COMPLIANCE_SENTINEL: TL-AUDT-003 | policy=compliance/SOC2/policies/02-audit-logging-policy.md | procedure=compliance/SOC2/procedures/02-audit-logging-procedure.md | control=nginx-log-rotation -->
<!-- COMPLIANCE_SENTINEL: TL-AUDT-004 | policy=compliance/SOC2/policies/02-audit-logging-policy.md | procedure=compliance/SOC2/procedures/02-audit-logging-procedure.md | control=audit-log-archive -->

## Frequency

- Execute at least quarterly.
- Execute after any infrastructure change that affects logging configuration.
- Execute after any Ansible playbook deployment that includes logging templates.

## Procedure Steps

1. Verify nginx logging configuration is deployed with audit_combined format.
2. Verify journald retention configuration is deployed with 90-day retention.
3. Verify logrotate configuration is deployed for nginx logs.
4. Verify audit archive timer is enabled and running.
5. Verify log files have appropriate permissions (root-owned, restricted).
6. Review recent log entries for expected format and content.
7. Record evidence (configuration state, test results, reviewer).

## Verification Commands

```bash
# Verify nginx logging configuration
cat /etc/nginx/conf.d/logging.conf
nginx -T 2>/dev/null | grep -A5 'log_format audit_combined'

# Verify journald retention configuration
cat /etc/systemd/journald.conf.d/compliance.conf
journalctl --disk-usage

# Verify logrotate configuration
cat /etc/logrotate.d/nginx

# Verify archive timer status
systemctl status audit-log-archive.timer
systemctl list-timers audit-log-archive.timer

# Verify log file permissions
ls -la /var/log/nginx/
ls -la /var/archive/audit-logs/

# Sample recent nginx access log entries
tail -5 /var/log/nginx/access.log

# Sample recent journald entries
journalctl -n 10 --no-pager
```

## Evidence Template

- Review date:
- Reviewer:
- Ansible playbook commit SHA:
- Controls verified: `TL-AUDT-001`, `TL-AUDT-002`, `TL-AUDT-003`, `TL-AUDT-004`
- Verification commands run:
- Configuration state summary:
- Log sample verification:
- Exceptions or remediation tasks:
