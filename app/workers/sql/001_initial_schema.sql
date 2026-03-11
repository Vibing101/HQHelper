-- APPEND-ONLY: Do not modify this file after it has been applied to any environment.
-- To change the schema, add a new numbered migration file (e.g. 003_my_change.sql).
-- Editing an applied file will be detected by apply-d1-migrations.sh and cause a
-- hard failure to prevent silent schema drift between environments.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  enabled_packs TEXT NOT NULL,
  party_id TEXT NOT NULL,
  current_session_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL UNIQUE,
  reputation_tokens INTEGER NOT NULL DEFAULT 0,
  unlocked_mercenary_types TEXT NOT NULL DEFAULT '[]',
  mercenaries_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quest_log (
  campaign_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('locked', 'available', 'completed')),
  completed_at TEXT,
  PRIMARY KEY (campaign_id, quest_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS heroes (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  party_id TEXT,
  player_id TEXT NOT NULL,
  hero_type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body_points_max INTEGER NOT NULL,
  body_points_current INTEGER NOT NULL,
  mind_points_max INTEGER NOT NULL,
  mind_points_current INTEGER NOT NULL,
  attack_dice INTEGER NOT NULL,
  defend_dice INTEGER NOT NULL,
  gold INTEGER NOT NULL DEFAULT 0,
  equipped_json TEXT NOT NULL DEFAULT '{}',
  inventory_json TEXT NOT NULL DEFAULT '[]',
  consumables_json TEXT NOT NULL DEFAULT '[]',
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  alchemy_json TEXT NOT NULL DEFAULT '{}',
  spells_json TEXT NOT NULL DEFAULT '[]',
  status_flags_json TEXT NOT NULL DEFAULT '{}',
  hideout_rest_used_this_quest INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_heroes_campaign_hero_type
  ON heroes (campaign_id, hero_type_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  rooms_json TEXT NOT NULL DEFAULT '[]',
  monsters_json TEXT NOT NULL DEFAULT '[]',
  rules_snapshot_json TEXT NOT NULL,
  session_flags_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_campaign_started
  ON sessions (campaign_id, started_at DESC);
