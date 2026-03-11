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
