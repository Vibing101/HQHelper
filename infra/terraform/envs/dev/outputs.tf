output "dev_instance_id" {
  description = "EC2 instance ID — use with: aws ssm start-session --target <id>"
  value       = aws_instance.dev.id
}

output "dev_public_ip" {
  description = "Elastic IP for SSH access: ssh -i your-key.pem ubuntu@<ip>"
  value       = aws_eip.dev.public_ip
}

output "app_url" {
  description = "Application URL (available ~5 min after apply while user_data bootstraps)"
  value       = "https://HQv2.${var.cf_zone_name}"
}

output "tunnel_id" {
  description = "Cloudflare tunnel ID — check status in CF dashboard → Zero Trust → Tunnels"
  value       = cloudflare_tunnel.hq.id
}

output "wake_url" {
  description = "Lambda Function URL to wake the EC2 when stopped — bookmark this"
  value       = aws_lambda_function_url.wake.function_url
}
