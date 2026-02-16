# Audit Logging Technical Control Map (HIPAA)

This map ties audit logging policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | HIPAA Citation | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- |
| `TL-HAUDT-001` | 164.312(b), 164.308(a)(1)(ii)(D) | Nginx access logging with audit-grade fields for ePHI system activity | `ansible/playbooks/main.yml` (nginx tasks) | Manual verification: `nginx -T \| grep audit_combined` |
| `TL-HAUDT-002` | 164.312(b), 164.308(a)(1)(ii)(D) | Journald 90-day persistent retention for activity review | `ansible/playbooks/main.yml` (journald tasks) | Manual verification: `cat /etc/systemd/journald.conf.d/compliance.conf` |
| `TL-HAUDT-003` | 164.312(b) | Nginx log rotation with 90-day retention and compression | `ansible/playbooks/main.yml` (logrotate tasks) | Manual verification: `cat /etc/logrotate.d/nginx` |
| `TL-HAUDT-004` | 164.316(b) | Monthly log archive with 6-year retention for documentation compliance | `ansible/playbooks/main.yml` (archive tasks) | Manual verification: `systemctl status audit-log-archive.timer` |

## HIPAA Security Rule Control Coverage

| Citation | Title | Specification | Implementation Status |
| --- | --- | --- | --- |
| 164.312(b) | Audit Controls | Required | Implemented via `TL-HAUDT-001`, `TL-HAUDT-002`, `TL-HAUDT-003` |
| 164.308(a)(1)(ii)(D) | Information System Activity Review | Required | Implemented via `TL-HAUDT-001`, `TL-HAUDT-002` |
| 164.316(b)(1) | Documentation | Required | Documented in this policy set |
| 164.316(b)(2)(i) | Time Limit (6 years) | Required | Implemented via `TL-HAUDT-004` |
| 164.316(b)(2)(ii) | Availability | Required | Archives in persistent storage |
| 164.316(b)(2)(iii) | Updates | Required | Policy maintained in version control |

## Deployment Automation

All audit logging controls are deployed via Ansible:

- **Playbook**: `ansible/playbooks/main.yml`
- **Templates directory**: `ansible/playbooks/templates/`

## Control Variables

| Variable | Default | Description |
| --- | --- | --- |
| `audit_log_retention_days` | 90 | Operational log retention period in days |
| `audit_archive_retention_years` | 6 | Long-term archive retention (HIPAA 164.316(b) minimum) |
| `audit_archive_dir` | /var/archive/audit-logs | Archive storage directory |
| `journald_system_max_use` | 4G | Maximum journal disk usage |
| `journald_runtime_max_use` | 500M | Maximum runtime journal usage |
| `nginx_log_rotate_days` | 90 | Nginx log rotation retention |

## Notes

- This is the second scoped policy/procedure/control mapping for HIPAA in this repository.
- The 6-year retention requirement (164.316(b)(2)(i)) is the driving factor for archive retention.
- Sentinel comments are embedded in Ansible Jinja2 templates using `{# ... #}` syntax.
- Log archive integrity should be verified periodically by sampling archived files.
- Consider future expansion to centralized log aggregation for enhanced audit capabilities.
