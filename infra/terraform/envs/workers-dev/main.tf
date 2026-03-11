locals {
  worker_hostname = "${var.worker_subdomain}.${var.cf_zone_name}"
  worker_entry    = "${path.module}/../../../../app/workers/src/index.mjs"
  worker_root     = "${path.module}/../../../../app/workers"
  worker_sql_dir  = "${local.worker_root}/sql"
  d1_schema_hash = sha256(join("", [
    for file_name in sort(fileset(local.worker_sql_dir, "*.sql")) :
    "${file_name}:${filesha256("${local.worker_sql_dir}/${file_name}")}"
  ]))
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
      type       = "durable_object_namespace"
      name       = "HQ_REALTIME"
      class_name = "CampaignRealtimeHub"
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
    },
    {
      type = "secret_text"
      name = "JWT_SECRET"
      text = var.jwt_secret
    }
  ]

  migrations = {
    tag                = "v1"
    new_sqlite_classes = ["CampaignRealtimeHub"]
  }

  modules = [
    {
      name         = "index.mjs"
      content_file = local.worker_entry
      content_type = "application/javascript+module"
    },
    {
      name         = "auth.mjs"
      content_file = "${local.worker_root}/src/auth.mjs"
      content_type = "application/javascript+module"
    },
    {
      name         = "data.mjs"
      content_file = "${local.worker_root}/src/data.mjs"
      content_type = "application/javascript+module"
    },
    {
      name         = "repository.mjs"
      content_file = "${local.worker_root}/src/repository.mjs"
      content_type = "application/javascript+module"
    },
    {
      name         = "commands.mjs"
      content_file = "${local.worker_root}/src/commands.mjs"
      content_type = "application/javascript+module"
    },
    {
      name         = "realtime.mjs"
      content_file = "${local.worker_root}/src/realtime.mjs"
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

resource "terraform_data" "apply_d1_migrations" {
  count = var.apply_d1_migrations ? 1 : 0

  triggers_replace = [
    cloudflare_d1_database.hq_helper.id,
    cloudflare_d1_database.hq_helper.name,
    local.d1_schema_hash,
  ]

  provisioner "local-exec" {
    interpreter = ["/bin/bash", "-c"]
    command     = "${path.module}/../../../../scripts/apply-d1-migrations.sh"

    environment = {
      D1_DATABASE_ID    = cloudflare_d1_database.hq_helper.id
      D1_DATABASE_NAME  = cloudflare_d1_database.hq_helper.name
      D1_MIGRATIONS_DIR = local.worker_sql_dir
      WORKERS_ROOT      = local.worker_root
    }
  }
}
