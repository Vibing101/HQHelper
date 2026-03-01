data "cloudflare_zone" "savvy_des" {
  name = var.cf_zone_name
}

# ── Tunnel secret (32 random bytes → base64) ──────────────────────────────────

resource "random_id" "tunnel_secret" {
  byte_length = 32
}

# ── Cloudflare Tunnel ─────────────────────────────────────────────────────────

resource "cloudflare_tunnel" "hq" {
  account_id = var.cloudflare_account_id
  name       = "hq-dev-tunnel"
  secret     = random_id.tunnel_secret.b64_std
}

# ── Tunnel ingress config (managed via Cloudflare API — no config.yml on EC2) ─
# cloudflared reads this remotely when started with 'service install <TOKEN>'.

resource "cloudflare_tunnel_config" "hq" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_tunnel.hq.id

  config {
    ingress_rule {
      hostname = "HQv2.${var.cf_zone_name}"
      service  = "http://localhost:4000"
    }
    # Catch-all: any other hostname returns 404
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# ── DNS: HQv2.savvy-des.com → tunnel ─────────────────────────────────────────
# Proxied (orange cloud) so Cloudflare handles SSL for browsers.

resource "cloudflare_record" "hq" {
  zone_id = data.cloudflare_zone.savvy_des.id
  name    = "HQv2"
  type    = "CNAME"
  content = "${cloudflare_tunnel.hq.id}.cfargotunnel.com"
  proxied = true
}
