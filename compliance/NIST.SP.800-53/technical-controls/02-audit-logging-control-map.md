# Audit Logging Technical Control Map (NIST SP 800-53)

This map ties audit logging policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | NIST Control | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- | --- |
| `TL-NAUDT-001` | AU-2, AU-3, AU-12 | Nginx access logging with AU-3 compliant fields (type, when, where, source, outcome, identity) | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (nginx tasks) | Manual verification: `nginx -T \| grep audit_combined` |
| `TL-NAUDT-002` | AU-4, AU-11 | Journald 90-day persistent retention with storage limits | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (journald tasks) | Manual verification: `cat /etc/systemd/journald.conf.d/compliance.conf` |
| `TL-NAUDT-003` | AU-4, AU-9 | Nginx log rotation with 90-day retention and compression | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (logrotate tasks) | Manual verification: `cat /etc/logrotate.d/nginx` |
| `TL-NAUDT-004` | AU-9, AU-11 | Monthly log archive with 6-year retention for compliance | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (archive tasks) | Manual verification: `systemctl status audit-log-archive.timer` |

## NIST SP 800-53 Control Coverage

| Control | Title | Implementation Status |
| --- | --- | --- |
| AU-1 | Policy and Procedures | Documented in this policy set |
| AU-2 | Event Logging | Implemented via `TL-NAUDT-001` |
| AU-3 | Content of Audit Records | Implemented via `TL-NAUDT-001` |
| AU-4 | Audit Log Storage Capacity | Implemented via `TL-NAUDT-002`, `TL-NAUDT-003` |
| AU-5 | Response to Audit Logging Process Failures | Future: implement alerting |
| AU-6 | Audit Record Review, Analysis, and Reporting | Procedure defined; manual process |
| AU-7 | Audit Record Reduction and Report Generation | Future: implement log analysis tools |
| AU-8 | Time Stamps | System time via NTP; ISO8601 in logs |
| AU-9 | Protection of Audit Information | Implemented via `TL-NAUDT-003`, `TL-NAUDT-004` |
| AU-10 | Non-repudiation | Partial: request_id provides correlation |
| AU-11 | Audit Record Retention | Implemented via `TL-NAUDT-002`, `TL-NAUDT-004` |
| AU-12 | Audit Record Generation | Implemented via `TL-NAUDT-001` |

## Deployment Automation

All audit logging controls are deployed via Ansible:

- **Playbook**: `terraform/stacks/staging/k8s/main.tf`
- **Kubernetes stack directory**: `terraform/stacks/staging/k8s/`

## Control Variables

| Variable | Default | Description |
| --- | --- | --- |
| `audit_log_retention_days` | 90 | Operational log retention period in days |
| `audit_archive_retention_years` | 6 | Long-term archive retention in years |
| `audit_archive_dir` | /var/archive/audit-logs | Archive storage directory |
| `journald_system_max_use` | 4G | Maximum journal disk usage |
| `journald_runtime_max_use` | 500M | Maximum runtime journal usage |
| `nginx_log_rotate_days` | 90 | Nginx log rotation retention |

## Notes

- This is the second scoped policy/procedure/control mapping for NIST SP 800-53 in this repository.
- Sentinel comments are embedded in Ansible Jinja2 templates using `{# ... #}` syntax.
- AU-5 (failure response) and AU-7 (analysis tools) are identified as future enhancements.
- Log archive integrity should be verified periodically by sampling archived files.
