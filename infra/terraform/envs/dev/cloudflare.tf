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
