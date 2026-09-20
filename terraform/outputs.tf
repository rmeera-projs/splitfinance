output "app_url" {
  description = "Give this to testers. Requires domain_name's DNS A record to point at the Elastic IP below before Caddy can issue its cert."
  value       = "https://${var.domain_name}"
}

output "api_url" {
  description = "Backend API (mostly for your own troubleshooting - /health should return {\"status\":\"ok\"})."
  value       = "https://${var.api_domain_name}/health"
}

output "direct_app_url" {
  description = "Frontend via the raw Elastic IP, bypassing Caddy/HTTPS. Only reachable from allowed_ssh_cidr - plaintext, debugging use only, e.g. while DNS is still propagating."
  value       = "http://${aws_eip.app.public_ip}:4173"
}

output "direct_api_url" {
  description = "Backend API via the raw Elastic IP, bypassing Caddy/HTTPS. Only reachable from allowed_ssh_cidr - plaintext, debugging use only."
  value       = "http://${aws_eip.app.public_ip}:5000/health"
}

output "ssh_command" {
  description = "SSH in to check on the instance or read /var/log/user-data.log."
  value       = "ssh -i terraform/splitfinance-key.pem ubuntu@${aws_eip.app.public_ip}"
}

output "instance_id" {
  value = aws_instance.app.id
}

output "security_log_tail_command" {
  description = "Live-tail the server's structured security events (server/src/services/securityLog.js) from CloudWatch."
  value       = "aws logs tail ${aws_cloudwatch_log_group.server_security.name} --region ${var.aws_region} --follow"
}

# Needed once, right after a `terraform apply -target=random_password.
# postgres_password ...`: retrieve via `terraform output -raw
# postgres_password` and set it on the live database with `ALTER USER`
# *before* applying the rest of the plan (the instance replacement), so
# the new instance's DATABASE_URL matches what Postgres actually has on
# record. Not otherwise printed anywhere by default - `terraform output`
# without -raw redacts it, matching every other sensitive value here.
output "postgres_password" {
  value     = random_password.postgres_password.result
  sensitive = true
}
