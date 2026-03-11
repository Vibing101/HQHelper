#!/usr/bin/env bash
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to apply D1 migrations via Wrangler." >&2
  exit 1
fi

: "${D1_DATABASE_ID:?D1_DATABASE_ID is required}"
: "${D1_DATABASE_NAME:?D1_DATABASE_NAME is required}"
: "${D1_MIGRATIONS_DIR:?D1_MIGRATIONS_DIR is required}"
: "${WORKERS_ROOT:?WORKERS_ROOT is required}"

if [[ ! -d "${D1_MIGRATIONS_DIR}" ]]; then
  echo "D1 migrations directory does not exist: ${D1_MIGRATIONS_DIR}" >&2
  exit 1
fi

if ! compgen -G "${D1_MIGRATIONS_DIR}/*.sql" >/dev/null; then
  echo "No D1 migration files found in ${D1_MIGRATIONS_DIR}" >&2
  exit 1
fi

tmp_config="$(mktemp "${WORKERS_ROOT}/wrangler.d1.XXXXXX.jsonc")"
cleanup() {
  rm -f "${tmp_config}"
}
trap cleanup EXIT

cat > "${tmp_config}" <<EOF
{
  "name": "hq-helper-d1-migrations",
  "compatibility_date": "2026-03-11",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "${D1_DATABASE_NAME}",
      "database_id": "${D1_DATABASE_ID}",
      "migrations_dir": "sql"
    }
  ]
}
EOF

(
  cd "${WORKERS_ROOT}"
  CI=1 npx --yes wrangler@4 d1 migrations apply DB --remote --config "${tmp_config}"
)
