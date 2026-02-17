# Audit Logging Technical Control Map (SOC2)

This map ties audit logging policy controls to concrete implementation and test evidence.

## Sentinel Controls

| Sentinel | Description | Implementation Evidence | Test Evidence |
| --- | --- | --- | --- |
| `TL-AUDT-001` | Nginx access logging with audit-grade fields (IP, timestamp, request, status, timing, SSL, request_id) | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (nginx tasks) | Manual verification: `nginx -T \| grep audit_combined` |
| `TL-AUDT-002` | Journald 90-day persistent retention with storage limits | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (journald tasks) | Manual verification: `cat /etc/systemd/journald.conf.d/compliance.conf` |
| `TL-AUDT-003` | Nginx log rotation with 90-day retention and compression | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (logrotate tasks) | Manual verification: `cat /etc/logrotate.d/nginx` |
| `TL-AUDT-004` | Monthly log archive with 6-year retention for compliance | [`terraform/stacks/staging/k8s/main.tf`](../../../terraform/stacks/staging/k8s/main.tf) (archive tasks) | Manual verification: `systemctl status audit-log-archive.timer` |

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

- This is the second scoped policy/procedure/control mapping for SOC2 in this repository.
- Sentinel comments are embedded in Ansible Jinja2 templates using `{# ... #}` syntax.
- Log archive integrity should be verified periodically by sampling archived files.
- Consider future expansion to centralized log aggregation (e.g., syslog forwarding to SIEM).
