variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Environment name (dev / staging / prod)"
  type        = string
  default     = "dev"
}

variable "instance_type" {
  description = "EC2 instance type. t3.small (2 GB) is the minimum — client Vite build needs ~1.2 GB RAM."
  type        = string
  default     = "t3.small"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (right sidebar of any CF dashboard page)"
  type        = string
}

variable "cf_zone_name" {
  description = "Cloudflare zone root domain"
  type        = string
  default     = "savvy-des.com"
}

variable "github_repo" {
  description = "GitHub repository (owner/repo) — must be public so EC2 can clone it"
  type        = string
  default     = "KaiChuul/HQ_Companioon_V5"
}

variable "ssh_public_key" {
  description = "SSH public key to inject into EC2 for admin access (contents of your ~/.ssh/id_ed25519.pub or similar)"
  type        = string
}

variable "admin_cidr" {
  description = "CIDR allowed to SSH into the EC2 instance. Restrict to your IP (x.x.x.x/32) for security."
  type        = string
  default     = "0.0.0.0/0"
}
