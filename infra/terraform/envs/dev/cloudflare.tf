data "cloudflare_zone" "savvy_des" {
  name = var.cf_zone_name
}

# Cloudflare Pages project (direct-upload mode)
resource "cloudflare_pages_project" "hq_client" {
  account_id        = var.cloudflare_account_id
  name              = var.cf_pages_project_name
  production_branch = "main"
}

# Attach the custom domain to the Pages project.
# Cloudflare verifies the domain by checking the CNAME record, so the DNS
# record must exist before this resource is created.
resource "cloudflare_pages_domain" "hq_client" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.hq_client.name
  domain       = "hqv2.${var.cf_zone_name}"

  depends_on = [cloudflare_record.pages]
}

# DNS CNAME: hqv2.savvy-des.com → Pages (proxied, CF handles SSL)
resource "cloudflare_record" "pages" {
  zone_id = data.cloudflare_zone.savvy_des.id
  name    = "hqv2"
  type    = "CNAME"
  content = "${var.cf_pages_project_name}.pages.dev"
  proxied = true
}

# DNS A: api.hqv2.savvy-des.com → EC2 Elastic IP (proxied, CF handles SSL + WebSocket)
resource "cloudflare_record" "api" {
  zone_id = data.cloudflare_zone.savvy_des.id
  name    = "api.hqv2"
  type    = "A"
  content = aws_eip.dev.public_ip
  proxied = true
}

# Build the client locally and deploy to CF Pages as part of terraform apply.
# CLOUDFLARE_API_TOKEN is already in the shell (required for the CF provider),
# so wrangler picks it up automatically — no extra variable needed.
resource "null_resource" "deploy_frontend" {
  triggers = {
    pages_project = cloudflare_pages_project.hq_client.id
  }

  provisioner "local-exec" {
    working_dir = "${path.root}/../../../../"
    command     = "npm run build && npx wrangler pages deploy app/client/dist --project-name=${var.cf_pages_project_name} --branch=main"
    environment = {
      VITE_SERVER_URL = "https://api.hqv2.${var.cf_zone_name}"
      VITE_WAKE_URL   = aws_lambda_function_url.wake.function_url
    }
  }

  depends_on = [cloudflare_pages_project.hq_client]
}
