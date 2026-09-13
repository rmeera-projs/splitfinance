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
  value       = "http://${aws_eip.app.public_ip}:5173"
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
