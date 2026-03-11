terraform {
  required_version = ">= 1.7"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.17"
    }
  }

  backend "s3" {
    bucket         = "hq-tfstate-kyriakos-2026-eu-central-1"
    key            = "workers-dev/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "hq-terraform-locks"
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
