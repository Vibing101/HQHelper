#!/usr/bin/env bash
# Migration files under app/workers/sql/ are append-only.
# Never edit a migration file after it has been applied to any environment.
# To change the schema, add a new numbered migration file instead.
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "jq required but not found — install jq and retry." >&2; exit 1; }

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

# Compute SHA-256 of a file; portable across Linux (sha256sum) and macOS (shasum).
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Drift guard: compare current checksums of every SQL file against the snapshot
# recorded when migrations were last successfully applied.  Any file that has
# been edited since its last apply causes a hard failure.
CHECKSUMS_FILE="${D1_MIGRATIONS_DIR}/.applied-checksums"
if [[ -f "${CHECKSUMS_FILE}" ]]; then
  drift_found=0
  while IFS=$'\t' read -r stored_hash filename; do
    local_file="${D1_MIGRATIONS_DIR}/${filename}"
    if [[ -f "${local_file}" ]]; then
      current_hash="$(sha256_file "${local_file}")"
      if [[ "${current_hash}" != "${stored_hash}" ]]; then
        echo "ERROR: Migration drift detected in '${filename}'." >&2
        echo "  Recorded checksum: ${stored_hash}" >&2
        echo "  Current checksum:  ${current_hash}" >&2
        echo "Migration files must not be edited after they have been applied." >&2
        echo "Create a new numbered migration file to make schema changes." >&2
        drift_found=1
      fi
    fi
  done < "${CHECKSUMS_FILE}"
  if [[ "${drift_found}" -ne 0 ]]; then
    exit 1
  fi
fi

tmp_config="$(mktemp "${WORKERS_ROOT}/wrangler.d1.XXXXXX.jsonc")"
cleanup() {
  rm -f "${tmp_config}"
}
trap cleanup EXIT

jq -n \
  --arg name "$D1_DATABASE_NAME" \
  --arg id   "$D1_DATABASE_ID" \
  '{
    name: "hq-helper-d1-migrations",
    compatibility_date: "2026-03-11",
    d1_databases: [
      {
        binding: "DB",
        database_name: $name,
        database_id: $id,
        migrations_dir: "sql"
      }
    ]
  }' \
  > "${tmp_config}"

(
  cd "${WORKERS_ROOT}"
  CI=1 npx wrangler d1 migrations apply DB --remote --config "${tmp_config}"
)

# Record the checksum of every SQL file so future runs can detect drift.
(
  for f in "${D1_MIGRATIONS_DIR}"/*.sql; do
    filename="$(basename "${f}")"
    hash="$(sha256_file "${f}")"
    printf '%s\t%s\n' "${hash}" "${filename}"
  done
) > "${CHECKSUMS_FILE}"
