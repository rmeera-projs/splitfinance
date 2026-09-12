output "app_url" {
  description = "Give this to testers."
  value       = "http://${aws_eip.app.public_ip}:5173"
}

output "api_url" {
  description = "Backend API (mostly for your own troubleshooting - /health should return {\"status\":\"ok\"})."
  value       = "http://${aws_eip.app.public_ip}:5000/health"
}

output "ssh_command" {
  description = "SSH in to check on the instance or read /var/log/user-data.log."
  value       = "ssh -i terraform/splitfinance-key.pem ubuntu@${aws_eip.app.public_ip}"
}

output "instance_id" {
  value = aws_instance.app.id
}
