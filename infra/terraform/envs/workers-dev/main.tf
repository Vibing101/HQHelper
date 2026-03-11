locals {
  worker_hostname = "${var.worker_subdomain}.${var.cf_zone_name}"
  worker_entry    = "${path.module}/../../../../app/workers/src/index.mjs"
}

data "cloudflare_zone" "savvy_des" {
  filter = {
    name = var.cf_zone_name
  }
}

resource "cloudflare_d1_database" "hq_helper" {
  account_id            = var.cloudflare_account_id
  name                  = var.d1_name
  primary_location_hint = var.d1_primary_location_hint
}

resource "cloudflare_worker" "hq_helper" {
  account_id = var.cloudflare_account_id
  name       = var.worker_name

  observability = {
    enabled = true
  }
}

resource "cloudflare_worker_version" "hq_helper" {
  account_id = var.cloudflare_account_id
  worker_id  = cloudflare_worker.hq_helper.id

  compatibility_date = "2026-03-11"
  main_module        = "index.mjs"

  bindings = [
    {
      type = "d1"
      name = "DB"
      id   = cloudflare_d1_database.hq_helper.id
    },
    {
      type = "plain_text"
      name = "APP_ENV"
      text = var.environment
    },
    {
      type = "plain_text"
      name = "APP_HOSTNAME"
      text = local.worker_hostname
    },
    {
      type = "plain_text"
      name = "APP_VERSION"
      text = "bootstrap"
    }
  ]

  modules = [
    {
      name         = "index.mjs"
      content_file = local.worker_entry
      content_type = "application/javascript+module"
    }
  ]
}

resource "cloudflare_workers_deployment" "hq_helper" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.hq_helper.name
  strategy    = "percentage"

  versions = [
    {
      version_id = cloudflare_worker_version.hq_helper.id
      percentage = 100
    }
  ]
}

resource "cloudflare_workers_custom_domain" "hq_helper" {
  account_id  = var.cloudflare_account_id
  environment = var.worker_environment
  zone_id     = data.cloudflare_zone.savvy_des.id
  hostname    = local.worker_hostname
  service     = cloudflare_worker.hq_helper.name
}
