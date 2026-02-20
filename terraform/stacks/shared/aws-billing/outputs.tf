output "sns_topic_arn" {
  description = "ARN of the billing alerts SNS topic"
  value       = aws_sns_topic.billing_alerts.arn
}

output "alert_email" {
  description = "Email address receiving billing alerts"
  value       = data.terraform_remote_state.gsuite.outputs.alerts_group_email
}

output "monthly_budget_id" {
  description = "ID of the monthly budget"
  value       = aws_budgets_budget.monthly.id
}
