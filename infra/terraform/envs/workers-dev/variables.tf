variable "environment" {
  description = "Environment name for the Cloudflare Workers stack."
  type        = string
  default     = "dev"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "cf_zone_name" {
  description = "Cloudflare zone root domain."
  type        = string
  default     = "savvy-des.com"
}

variable "worker_name" {
  description = "Cloudflare Worker service name."
  type        = string
  default     = "hq-helper-dev"
}

variable "worker_environment" {
  description = "Cloudflare Worker environment name used by resources that require it."
  type        = string
  default     = "production"
}

variable "apply_d1_migrations" {
  description = "Whether terraform apply should invoke Wrangler to apply D1 SQL migrations after the database exists."
  type        = bool
  default     = true
}

variable "worker_subdomain" {
  description = "Subdomain for the Cloudflare Workers fork."
  type        = string
  default     = "HQHelper"
}

variable "d1_name" {
  description = "D1 database name."
  type        = string
  default     = "hq-helper-dev"
}

variable "d1_primary_location_hint" {
  description = "Preferred location hint for the D1 primary."
  type        = string
  default     = "weur"
}

variable "jwt_secret" {
  description = "JWT signing secret for the HQ Helper Worker. Must be set before a real apply."
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID"
  type        = string
}