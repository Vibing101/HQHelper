import { QUEST_ORDER } from "./data.mjs";

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeDate(value) {
  return value ?? undefined;
}

export function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createJoinCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    result += alphabet[byte % alphabet.length];
  }
  return result;
}

export function mapCampaign(row, questLog) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    enabledPacks: parseJson(row.enabled_packs, []),
    partyId: row.party_id,
    currentSessionId: row.current_session_id ?? undefined,
    questLog,
    createdAt: row.created_at,
  };
}

export function mapCampaignPublic(row, questLog) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    enabledPacks: parseJson(row.enabled_packs, []),
    partyId: row.party_id,
    currentSessionId: row.current_session_id ?? undefined,
    questLog,
    createdAt: row.created_at,
  };
}

export function mapHero(row) {
  if (!row) return null;
  const statusFlags = parseJson(row.status_flags_json, {});
  return {
    id: row.id,
    heroTypeId: row.hero_type_id,
    name: row.name,
    playerId: row.player_id,
    campaignId: row.campaign_id,
    partyId: row.party_id ?? undefined,
    bodyPointsMax: row.body_points_max,
    bodyPointsCurrent: row.body_points_current,
    mindPointsMax: row.mind_points_max,
    mindPointsCurrent: row.mind_points_current,
    attackDice: row.attack_dice,
    defendDice: row.defend_dice,
    gold: row.gold,
    equipped: parseJson(row.equipped_json, {}),
    inventory: parseJson(row.inventory_json, []),
    consumables: parseJson(row.consumables_json, []),
    artifacts: parseJson(row.artifacts_json, []),
    alchemy: parseJson(row.alchemy_json, { reagents: [], potions: [] }),
    hideoutRestUsedThisQuest: Boolean(row.hideout_rest_used_this_quest),
    spellsChosenThisQuest: parseJson(row.spells_json, []),
    statusFlags: {
      isDead: Boolean(statusFlags.isDead),
      isInShock: Boolean(statusFlags.isInShock),
      isDisguised: Boolean(statusFlags.isDisguised),
      hasDisguiseToken: Boolean(statusFlags.hasDisguiseToken),
      disguiseBrokenReason: statusFlags.disguiseBrokenReason ?? undefined,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapParty(row, heroIds) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    heroIds,
    reputationTokens: row.reputation_tokens,
    unlockedMercenaryTypes: parseJson(row.unlocked_mercenary_types, []),
    mercenaries: parseJson(row.mercenaries_json, []),
  };
}

export function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    questId: row.quest_id,
    rooms: parseJson(row.rooms_json, []),
    monsters: parseJson(row.monsters_json, []),
    rulesSnapshot: parseJson(row.rules_snapshot_json, {}),
    sessionFlags: parseJson(row.session_flags_json, {}),
    startedAt: row.started_at,
    endedAt: normalizeDate(row.ended_at),
  };
}

export async function getQuestLog(db, campaignId) {
  const rows = await db
    .prepare(
      `SELECT quest_id, status, completed_at
       FROM quest_log
       WHERE campaign_id = ?`
    )
    .bind(campaignId)
    .all();

  return (rows.results ?? [])
    .map((row) => ({
      questId: row.quest_id,
      status: row.status,
      completedAt: normalizeDate(row.completed_at),
    }))
    .sort((left, right) => (QUEST_ORDER.get(left.questId) ?? 999) - (QUEST_ORDER.get(right.questId) ?? 999));
}

export async function getCampaignById(db, campaignId) {
  const row = await db.prepare("SELECT * FROM campaigns WHERE id = ?").bind(campaignId).first();
  if (!row) return null;
  const questLog = await getQuestLog(db, campaignId);
  return mapCampaign(row, questLog);
}

export async function getCampaignByIdPublic(db, campaignId) {
  const row = await db.prepare("SELECT * FROM campaigns WHERE id = ?").bind(campaignId).first();
  if (!row) return null;
  const questLog = await getQuestLog(db, campaignId);
  return mapCampaignPublic(row, questLog);
}

export async function getCampaignByJoinCode(db, joinCode) {
  const row = await db
    .prepare("SELECT * FROM campaigns WHERE join_code = ?")
    .bind(joinCode.toUpperCase())
    .first();
  if (!row) return null;
  const questLog = await getQuestLog(db, row.id);
  return mapCampaign(row, questLog);
}

export async function getHeroById(db, heroId) {
  const row = await db.prepare("SELECT * FROM heroes WHERE id = ?").bind(heroId).first();
  return mapHero(row);
}

export async function listHeroesByCampaign(db, campaignId) {
  const rows = await db
    .prepare("SELECT * FROM heroes WHERE campaign_id = ? ORDER BY created_at ASC")
    .bind(campaignId)
    .all();

  return (rows.results ?? []).map(mapHero);
}

export async function getPartyById(db, partyId) {
  const row = await db.prepare("SELECT * FROM parties WHERE id = ?").bind(partyId).first();
  if (!row) return null;
  const heroRows = await db
    .prepare("SELECT id FROM heroes WHERE party_id = ? ORDER BY created_at ASC")
    .bind(partyId)
    .all();
  const heroIds = (heroRows.results ?? []).map((hero) => hero.id);
  return mapParty(row, heroIds);
}

export async function getSessionById(db, sessionId) {
  const row = await db.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first();
  return mapSession(row);
}

export async function buildSnapshot(db, campaignId, preferredSessionId) {
  const campaign = await getCampaignByIdPublic(db, campaignId);
  if (!campaign) {
    return {
      campaign: null,
      party: null,
      heroes: [],
      session: null,
      requestedAt: new Date().toISOString(),
    };
  }

  const party = campaign.partyId ? await getPartyById(db, campaign.partyId) : null;
  const heroes = await listHeroesByCampaign(db, campaignId);
  const sessionId = preferredSessionId ?? campaign.currentSessionId ?? undefined;
  const session = sessionId ? await getSessionById(db, sessionId) : null;

  return {
    campaign,
    party,
    heroes,
    session,
    requestedAt: new Date().toISOString(),
  };
}
