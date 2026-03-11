# Cloudflare Workers Fork

This document tracks the new Cloudflare-native fork of the HeroQuest Companion app.

## Goal

Move the app from:

- EC2
- Express
- Socket.IO
- MongoDB
- Cloudflare Tunnel

to:

- Cloudflare Workers
- D1
- Durable Objects
- Cloudflare custom domain at `HQHelper.savvy-des.com`
- Terraform-managed infrastructure and deployment resources

## Current status

Implemented in this milestone:

- A separate Terraform environment at `infra/terraform/envs/workers-dev`
- A Cloudflare Worker service managed by Terraform
- A custom domain managed by Terraform: `HQHelper.savvy-des.com`
- A D1 database resource managed by Terraform
- A bootstrap Worker at `app/workers/src/index.mjs`
- An initial D1 schema draft at `app/workers/sql/001_initial_schema.sql`

Not implemented yet:

- REST API parity with the Express server
- Durable Object realtime session layer
- Frontend migration away from `socket.io-client`
- Terraform CLI compatibility validation beyond local `terraform init`

Implemented after bootstrap:

- Terraform-driven D1 schema application via versioned SQL files in `app/workers/sql`
- Terraform `local-exec` step that runs `wrangler d1 migrations apply --remote` after D1 database creation

## Milestones

1. Bootstrap Cloudflare infrastructure
2. Port persistence from MongoDB/Mongoose to D1
3. Port REST endpoints to Worker handlers
4. Port realtime session engine to Durable Objects
5. Migrate frontend transport and environment handling
6. Run multiplayer smoke validation
7. Cut traffic over to the Workers deployment

## Terraform note

Cloudflare Terraform can provision the Worker, custom domain, and D1 database directly.
This repo now handles SQL schema application through Terraform by keeping D1 migrations as
versioned `.sql` files under `app/workers/sql` and invoking Wrangler from Terraform after
the D1 database resource exists.

Implementation choice:

- Terraform creates the D1 database with the Cloudflare provider.
- Terraform tracks the hash of the SQL files in `app/workers/sql`.
- When the database identity or SQL hash changes, Terraform reruns a local migration step.
- That step executes `wrangler d1 migrations apply DB --remote` against a temporary config
  generated from Terraform outputs, keeping the actual database ID in sync without storing
  account-specific Wrangler config in the repo.

Operational notes:

- The repo is pinned to Terraform `1.14.7` via `.terraform-version`.
- `terraform validate` succeeds outside the Codex sandbox.
- The migration step requires `npx` and a valid Cloudflare auth context in the shell running `terraform apply`.
