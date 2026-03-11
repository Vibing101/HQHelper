import {
  ALL_SPELL_ELEMENTS,
  ALCHEMY_POTIONS,
  HERO_SPELL_ACCESS,
  MERCENARY_STATS,
  MONSTER_TYPES,
  QUESTS,
  QUEST_ORDER,
  UNDERGROUND_ITEMS,
  resolveEffectiveRules,
} from "./data.mjs";
import {
  createId,
  getCampaignById,
  getHeroById,
  getPartyById,
  getSessionById,
  mapHero,
} from "./repository.mjs";

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function getRawCampaign(db, campaignId) {
  return db.prepare("SELECT * FROM campaigns WHERE id = ?").bind(campaignId).first();
}

async function getRawHero(db, heroId) {
  return db.prepare("SELECT * FROM heroes WHERE id = ?").bind(heroId).first();
}

async function getRawSession(db, sessionId) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first();
}

async function getRawParty(db, partyId) {
  return db.prepare("SELECT * FROM parties WHERE id = ?").bind(partyId).first();
}

async function getRulesForCampaign(db, campaignId, sessionId) {
  const session = sessionId ? await getSessionById(db, sessionId) : null;
  if (session?.rulesSnapshot) return session.rulesSnapshot;
  const campaign = await getCampaignById(db, campaignId);
  if (!campaign) return null;
  const activeSession = campaign.currentSessionId ? await getSessionById(db, campaign.currentSessionId) : null;
  if (activeSession?.rulesSnapshot) return activeSession.rulesSnapshot;
  return resolveEffectiveRules(campaign.enabledPacks);
}

function ensureAuthorizedHero(payload, hero) {
  return payload.role === "gm" || hero.playerId === payload.playerId;
}

function assertSessionInCampaign(session, campaignId) {
  const sessionCampaignId = session.campaignId ?? session.campaign_id;
  if (sessionCampaignId !== campaignId) throw new Error("Session does not belong to this campaign");
}

async function refresh(notify, campaignId, sessionId) {
  await notify(campaignId, { type: "refresh", sessionId });
}

export async function executeCommand(cmd, context) {
  const { db, payload, notify } = context;
  const campaignId = payload.campaignId;

  switch (cmd.type) {
    case "REQUEST_SNAPSHOT":
      await notify(campaignId, { type: "refresh", sessionId: cmd.sessionId, target: payload.playerId ?? payload.role });
      return;
    case "ROLL_DICE":
      await notify(campaignId, { type: "dice_roll", ...cmd });
      return;
    case "ADJUST_POINTS": {
      if (cmd.entityType === "hero") {
        const hero = await getHeroById(db, cmd.entityId);
        if (!hero) throw new Error("Hero not found");
        if (!ensureAuthorizedHero(payload, hero)) throw new Error("Not authorized to adjust this hero");
        const rules = await getRulesForCampaign(db, hero.campaignId, cmd.sessionId);
        const updates = { ...hero };
        if (cmd.pool === "BP") {
          updates.bodyPointsCurrent = Math.max(0, Math.min(hero.bodyPointsMax, hero.bodyPointsCurrent + cmd.delta));
          updates.statusFlags = { ...hero.statusFlags, isDead: updates.bodyPointsCurrent === 0 };
        } else {
          updates.mindPointsCurrent = Math.max(0, Math.min(hero.mindPointsMax, hero.mindPointsCurrent + cmd.delta));
          updates.statusFlags = {
            ...hero.statusFlags,
            isInShock: Boolean(rules?.enabledSystems?.mindShock) && updates.mindPointsCurrent === 0,
          };
        }
        await db.prepare(
          "UPDATE heroes SET body_points_current = ?, mind_points_current = ?, status_flags_json = ?, updated_at = ? WHERE id = ?"
        ).bind(
          updates.bodyPointsCurrent,
          updates.mindPointsCurrent,
          JSON.stringify(updates.statusFlags),
          nowIso(),
          hero.id,
        ).run();
        await refresh(notify, hero.campaignId, cmd.sessionId);
        return;
      }
      if (payload.role !== "gm") throw new Error("Only GM can adjust monster stats");
      const rawSession = await getRawSession(db, cmd.sessionId);
      if (!rawSession) throw new Error("Session not found");
      assertSessionInCampaign(rawSession, campaignId);
      const monsters = parseJson(rawSession.monsters_json, []);
      const monster = monsters.find((entry) => entry.id === cmd.entityId);
      if (!monster) throw new Error("Monster not found");
      if (cmd.pool === "BP") {
        monster.bodyPointsCurrent = Math.max(0, Math.min(monster.bodyPointsMax, monster.bodyPointsCurrent + cmd.delta));
      } else {
        monster.mindPointsCurrent = Math.max(0, (monster.mindPointsCurrent ?? 0) + cmd.delta);
      }
      await db.prepare("UPDATE sessions SET monsters_json = ? WHERE id = ?").bind(JSON.stringify(monsters), rawSession.id).run();
      await refresh(notify, campaignId, cmd.sessionId);
      return;
    }
    case "USE_ITEM": {
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      if (!ensureAuthorizedHero(payload, hero)) throw new Error("Not authorized to use items for this hero");
      const consumables = [...hero.consumables];
      const idx = consumables.findIndex((item) => item.instanceId === cmd.itemId || item.itemId === cmd.itemId);
      if (idx === -1) throw new Error("Consumable not found in hero inventory");
      const item = { ...consumables[idx] };
      if ((item.quantity ?? 1) <= 1) {
        consumables.splice(idx, 1);
      } else {
        item.quantity -= 1;
        consumables[idx] = item;
      }
      let body = hero.bodyPointsCurrent;
      let mind = hero.mindPointsCurrent;
      let statusFlags = { ...hero.statusFlags };
      if (item.itemId === "healing_potion") body = Math.min(hero.bodyPointsMax, body + 4);
      if (item.itemId === "healing_herb") body = Math.min(hero.bodyPointsMax, body + 2);
      if (item.itemId === "holy_water") {
        statusFlags.isInShock = false;
        if (mind === 0) mind = 1;
      }
      statusFlags.isDead = body === 0;
      await db.prepare(
        "UPDATE heroes SET body_points_current = ?, mind_points_current = ?, consumables_json = ?, status_flags_json = ?, updated_at = ? WHERE id = ?"
      ).bind(body, mind, JSON.stringify(consumables), JSON.stringify(statusFlags), nowIso(), hero.id).run();
      await refresh(notify, hero.campaignId, cmd.sessionId);
      return;
    }
    case "SELECT_SPELL": {
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      if (!ensureAuthorizedHero(payload, hero)) throw new Error("Not authorized");
      const access = HERO_SPELL_ACCESS[hero.heroTypeId];
      if (!access) throw new Error("This hero cannot cast spells");
      let spells = [...hero.spellsChosenThisQuest];
      if (cmd.chosen) {
        if (!spells.includes(cmd.spell)) {
          if (spells.length >= access.elementLimit) throw new Error(`Can only select ${access.elementLimit} spells`);
          spells.push(cmd.spell);
        }
      } else {
        spells = spells.filter((spell) => spell !== cmd.spell);
      }
      const elfStatement = db.prepare("UPDATE heroes SET spells_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(spells), nowIso(), hero.id);
      let wizardStatement = null;
      if (cmd.chosen && hero.heroTypeId === "elf" && spells.length === 1) {
        const wizardRow = await db.prepare("SELECT * FROM heroes WHERE campaign_id = ? AND hero_type_id = 'wizard'").bind(hero.campaignId).first();
        if (wizardRow) {
          const wizard = mapHero(wizardRow);
          if (wizard.spellsChosenThisQuest.length === 2) {
            const taken = new Set([...wizard.spellsChosenThisQuest, ...spells]);
            const remaining = ALL_SPELL_ELEMENTS.find((element) => !taken.has(element));
            if (remaining) {
              wizardStatement = db.prepare("UPDATE heroes SET spells_json = ?, updated_at = ? WHERE id = ?")
                .bind(JSON.stringify([...wizard.spellsChosenThisQuest, remaining]), nowIso(), wizard.id);
            }
          }
        }
      }
      if (wizardStatement) {
        await db.batch([elfStatement, wizardStatement]);
      } else {
        await elfStatement.run();
      }
      await refresh(notify, hero.campaignId, cmd.sessionId);
      return;
    }
    case "START_SESSION": {
      if (payload.role !== "gm") throw new Error("Only GM can start a session");
      const campaign = await getCampaignById(db, campaignId);
      if (!campaign) throw new Error("Campaign not found");
      const quest = QUESTS.find((entry) => entry.id === cmd.questId);
      if (!quest) throw new Error("Quest not found");
      if (!campaign.enabledPacks.includes(quest.packId)) throw new Error(`Pack ${quest.packId} not enabled for this campaign`);
      const sessionId = createId("session");
      const session = {
        id: sessionId,
        campaignId,
        questId: cmd.questId,
        rooms: [],
        monsters: [],
        rulesSnapshot: resolveEffectiveRules(campaign.enabledPacks, quest),
        sessionFlags: {},
        startedAt: nowIso(),
      };
      await db.batch([
        db.prepare(
          `INSERT INTO sessions (id, campaign_id, quest_id, rooms_json, monsters_json, rules_snapshot_json, session_flags_json, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        ).bind(sessionId, campaignId, cmd.questId, "[]", "[]", JSON.stringify(session.rulesSnapshot), "{}", session.startedAt),
        db.prepare("UPDATE campaigns SET current_session_id = ? WHERE id = ?").bind(sessionId, campaignId),
      ]);
      await refresh(notify, campaignId, sessionId);
      return;
    }
    case "END_SESSION": {
      if (payload.role !== "gm") throw new Error("Only GM can end a session");
      const session = await getSessionById(db, cmd.sessionId);
      if (!session) throw new Error("Session not found");
      assertSessionInCampaign(session, campaignId);
      await db.batch([
        db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").bind(nowIso(), cmd.sessionId),
        db.prepare("UPDATE campaigns SET current_session_id = NULL WHERE id = ?").bind(session.campaignId),
        db.prepare(
          "UPDATE heroes SET body_points_current = body_points_max, mind_points_current = mind_points_max, status_flags_json = ?, hideout_rest_used_this_quest = 0, spells_json = '[]', updated_at = ? WHERE campaign_id = ?"
        ).bind(JSON.stringify({ isDead: false, isInShock: false, isDisguised: false, hasDisguiseToken: false }), nowIso(), session.campaignId),
      ]);
      await refresh(notify, session.campaignId, cmd.sessionId);
      return;
    }
    case "SET_QUEST_STATUS": {
      if (payload.role !== "gm") throw new Error("Only GM can update quest status");
      const completedAt = cmd.status === "completed" ? nowIso() : null;
      await db.prepare("UPDATE quest_log SET status = ?, completed_at = ? WHERE campaign_id = ? AND quest_id = ?")
        .bind(cmd.status, completedAt, campaignId, cmd.questId).run();
      if (cmd.status === "completed") {
        const nextQuest = QUESTS[QUEST_ORDER.get(cmd.questId) + 1];
        if (nextQuest) {
          await db.prepare("UPDATE quest_log SET status = 'available' WHERE campaign_id = ? AND quest_id = ? AND status = 'locked'")
            .bind(campaignId, nextQuest.id).run();
        }
        await db.prepare("UPDATE heroes SET spells_json = '[]', updated_at = ? WHERE campaign_id = ?").bind(nowIso(), campaignId).run();
      }
      await refresh(notify, campaignId, cmd.sessionId);
      return;
    }
    case "SET_ROOM_STATE": {
      if (payload.role !== "gm") throw new Error("Only GM can reveal rooms");
      const session = await getSessionById(db, cmd.sessionId);
      if (!session) throw new Error("Session not found");
      assertSessionInCampaign(session, campaignId);
      const rooms = [...session.rooms];
      const idx = rooms.findIndex((room) => room.roomId === cmd.roomId);
      if (idx === -1) rooms.push({ roomId: cmd.roomId, state: cmd.state });
      else rooms[idx] = { ...rooms[idx], state: cmd.state };
      await db.prepare("UPDATE sessions SET rooms_json = ? WHERE id = ?").bind(JSON.stringify(rooms), cmd.sessionId).run();
      await refresh(notify, session.campaignId, cmd.sessionId);
      return;
    }
    case "SPAWN_MONSTER": {
      if (payload.role !== "gm") throw new Error("Only GM can spawn monsters");
      const session = await getSessionById(db, cmd.sessionId);
      if (!session) throw new Error("Session not found");
      assertSessionInCampaign(session, campaignId);
      const monsters = [...session.monsters, {
        id: createId(cmd.monsterTypeId),
        monsterTypeId: cmd.monsterTypeId,
        label: cmd.label,
        bodyPointsCurrent: cmd.bodyPointsMax,
        bodyPointsMax: cmd.bodyPointsMax,
        mindPointsCurrent: cmd.mindPointsCurrent,
        roomId: cmd.roomId,
      }];
      await db.prepare("UPDATE sessions SET monsters_json = ? WHERE id = ?").bind(JSON.stringify(monsters), cmd.sessionId).run();
      await refresh(notify, session.campaignId, cmd.sessionId);
      return;
    }
    case "REMOVE_MONSTER": {
      if (payload.role !== "gm") throw new Error("Only GM can remove monsters");
      const session = await getSessionById(db, cmd.sessionId);
      if (!session) throw new Error("Session not found");
      assertSessionInCampaign(session, campaignId);
      const monsters = session.monsters.filter((monster) => monster.id !== cmd.monsterId);
      await db.prepare("UPDATE sessions SET monsters_json = ? WHERE id = ?").bind(JSON.stringify(monsters), cmd.sessionId).run();
      await refresh(notify, session.campaignId, cmd.sessionId);
      return;
    }
    case "SET_MONSTER_STATUS": {
      if (payload.role !== "gm") throw new Error("Only GM can update monster statuses");
      const session = await getSessionById(db, cmd.sessionId);
      if (!session) throw new Error("Session not found");
      assertSessionInCampaign(session, campaignId);
      const monsters = session.monsters.map((monster) =>
        monster.id === cmd.monsterId
          ? { ...monster, statusFlags: { ...(monster.statusFlags ?? {}), [cmd.status]: cmd.value } }
          : monster
      );
      await db.prepare("UPDATE sessions SET monsters_json = ? WHERE id = ?").bind(JSON.stringify(monsters), cmd.sessionId).run();
      await refresh(notify, session.campaignId, cmd.sessionId);
      return;
    }
    case "ADD_GOLD": {
      if (payload.role !== "gm") throw new Error("Only GM can adjust gold");
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      await db.prepare("UPDATE heroes SET gold = ?, updated_at = ? WHERE id = ?")
        .bind(Math.max(0, hero.gold + cmd.amount), nowIso(), hero.id).run();
      await refresh(notify, hero.campaignId, cmd.sessionId);
      return;
    }
    case "EQUIP_ITEM": {
      if (payload.role !== "gm") throw new Error("Only GM can equip items");
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      const equipped = { ...hero.equipped };
      const inventory = [...hero.inventory];
      const current = equipped[cmd.slot];
      if (current) inventory.push(current);
      const idx = inventory.findIndex((item) => item.itemId === cmd.itemId);
      const instanceId = idx >= 0 ? inventory[idx].instanceId : crypto.randomUUID().slice(0, 8);
      if (idx >= 0) inventory.splice(idx, 1);
      equipped[cmd.slot] = { instanceId, itemId: cmd.itemId };
      await db.prepare("UPDATE heroes SET equipped_json = ?, inventory_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(equipped), JSON.stringify(inventory), nowIso(), hero.id).run();
      await refresh(notify, hero.campaignId, cmd.sessionId);
      return;
    }
    case "UNEQUIP_ITEM": {
      if (payload.role !== "gm") throw new Error("Only GM can unequip items");
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      const equipped = { ...hero.equipped };
      const inventory = [...hero.inventory];
      if (equipped[cmd.slot]) inventory.push(equipped[cmd.slot]);
      delete equipped[cmd.slot];
      await db.prepare("UPDATE heroes SET equipped_json = ?, inventory_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(equipped), JSON.stringify(inventory), nowIso(), hero.id).run();
      await refresh(notify, hero.campaignId, cmd.sessionId);
      return;
    }
    case "ADD_CONSUMABLE": {
      if (payload.role !== "gm") throw new Error("Only GM can add consumables");
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      const consumables = [...hero.consumables, {
        instanceId: crypto.randomUUID().slice(0, 8),
        itemId: cmd.name.toLowerCase().replace(/\s+/g, "_"),
        quantity: cmd.quantity ?? 1,
        name: cmd.name,
        effect: cmd.effect,
      }];
      await db.prepare("UPDATE heroes SET consumables_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(consumables), nowIso(), hero.id).run();
      await refresh(notify, hero.campaignId, cmd.sessionId);
      return;
    }
    case "SET_HERO_DISGUISE": {
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      if (!ensureAuthorizedHero(payload, hero)) throw new Error("Not authorized to change disguise state");
      const statusFlags = { ...hero.statusFlags, isDisguised: cmd.isDisguised, hasDisguiseToken: cmd.isDisguised };
      if (!cmd.isDisguised) delete statusFlags.disguiseBrokenReason;
      await db.prepare("UPDATE heroes SET status_flags_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(statusFlags), nowIso(), hero.id).run();
      await refresh(notify, hero.campaignId, cmd.sessionId);
      return;
    }
    case "ADJUST_REPUTATION": {
      if (payload.role !== "gm") throw new Error("Only GM can adjust reputation");
      const campaign = await getCampaignById(db, campaignId);
      const party = await getPartyById(db, campaign.partyId);
      await db.prepare("UPDATE parties SET reputation_tokens = ? WHERE id = ?")
        .bind(Math.max(0, party.reputationTokens + cmd.amount), party.id).run();
      await refresh(notify, campaignId, cmd.sessionId);
      return;
    }
    case "UNLOCK_MERCENARY_TYPE": {
      if (payload.role !== "gm") throw new Error("Only GM can unlock mercenary types");
      const campaign = await getCampaignById(db, campaignId);
      const rawParty = await getRawParty(db, campaign.partyId);
      const unlocked = parseJson(rawParty.unlocked_mercenary_types, []);
      if (!unlocked.includes(cmd.mercenaryTypeId)) unlocked.push(cmd.mercenaryTypeId);
      await db.prepare("UPDATE parties SET unlocked_mercenary_types = ? WHERE id = ?")
        .bind(JSON.stringify(unlocked), rawParty.id).run();
      await refresh(notify, campaignId, cmd.sessionId);
      return;
    }
    case "HIRE_MERCENARY": {
      if (payload.role !== "gm") throw new Error("Only GM can hire mercenaries");
      const campaign = await getCampaignById(db, campaignId);
      const rawParty = await getRawParty(db, campaign.partyId);
      const unlocked = parseJson(rawParty.unlocked_mercenary_types, []);
      if (!unlocked.includes(cmd.mercenaryTypeId)) throw new Error("Mercenary type is not unlocked");
      const mercenaries = parseJson(rawParty.mercenaries_json, []);
      if (mercenaries.some((merc) => merc.mercenaryTypeId === cmd.mercenaryTypeId)) {
        throw new Error("Only one of each mercenary type can be hired per quest");
      }
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      const mercenary = MERCENARY_STATS[cmd.mercenaryTypeId];
      if (!mercenary) throw new Error("Unknown mercenary type");
      mercenaries.push({
        id: crypto.randomUUID().slice(0, 8),
        mercenaryTypeId: cmd.mercenaryTypeId,
        name: mercenary.name,
        bodyPointsCurrent: mercenary.bodyPointsMax,
        bodyPointsMax: mercenary.bodyPointsMax,
        hiredByHeroId: cmd.heroId,
      });
      if (cmd.payWith === "gold") {
        if (hero.gold < mercenary.costGold) throw new Error("Not enough gold");
        await db.batch([
          db.prepare("UPDATE heroes SET gold = ?, updated_at = ? WHERE id = ?")
            .bind(hero.gold - mercenary.costGold, nowIso(), hero.id),
          db.prepare("UPDATE parties SET mercenaries_json = ? WHERE id = ?")
            .bind(JSON.stringify(mercenaries), rawParty.id),
        ]);
      } else {
        if (rawParty.reputation_tokens < 1) throw new Error("Not enough reputation tokens");
        await db.batch([
          db.prepare("UPDATE parties SET reputation_tokens = ?, mercenaries_json = ? WHERE id = ?")
            .bind(rawParty.reputation_tokens - 1, JSON.stringify(mercenaries), rawParty.id),
        ]);
      }
      await refresh(notify, campaignId, cmd.sessionId);
      return;
    }
    case "DISMISS_MERCENARY": {
      if (payload.role !== "gm") throw new Error("Only GM can dismiss mercenaries");
      const campaign = await getCampaignById(db, campaignId);
      const rawParty = await getRawParty(db, campaign.partyId);
      const mercenaries = parseJson(rawParty.mercenaries_json, []).filter((merc) => merc.id !== cmd.mercenaryId);
      await db.prepare("UPDATE parties SET mercenaries_json = ? WHERE id = ?")
        .bind(JSON.stringify(mercenaries), rawParty.id).run();
      await refresh(notify, campaignId, cmd.sessionId);
      return;
    }
    case "ADD_REAGENT":
    case "REMOVE_REAGENT":
    case "CRAFT_POTION":
    case "DRAW_RANDOM_ALCHEMY_POTION":
    case "BUY_UNDERGROUND_ITEM":
    case "USE_HIDEOUT_REST": {
      const hero = await getHeroById(db, cmd.heroId);
      if (!hero) throw new Error("Hero not found");
      if (!ensureAuthorizedHero(payload, hero)) throw new Error("Not authorized");
      const alchemy = hero.alchemy ?? { reagents: [], potions: [], reagentKitUsesRemaining: 0 };
      const consumables = [...hero.consumables];
      let gold = hero.gold;
      let body = hero.bodyPointsCurrent;
      let mind = hero.mindPointsCurrent;
      const statusFlags = { ...hero.statusFlags };
      if (cmd.type === "ADD_REAGENT") alchemy.reagents.push(cmd.reagentId);
      if (cmd.type === "REMOVE_REAGENT") {
        const idx = alchemy.reagents.findIndex((reagent) => reagent === cmd.reagentId);
        if (idx === -1) throw new Error("Reagent not found");
        alchemy.reagents.splice(idx, 1);
      }
      if (cmd.type === "CRAFT_POTION") {
        for (const reagentId of cmd.consumeReagentIds) {
          const idx = alchemy.reagents.findIndex((reagent) => reagent === reagentId);
          if (idx === -1) throw new Error(`Missing reagent: ${reagentId}`);
          alchemy.reagents.splice(idx, 1);
        }
        if (cmd.useReagentKit) {
          if ((alchemy.reagentKitUsesRemaining ?? 0) <= 0) throw new Error("No reagent kit uses remaining");
          alchemy.reagentKitUsesRemaining -= 1;
        }
        alchemy.potions.push(cmd.potionId);
      }
      if (cmd.type === "DRAW_RANDOM_ALCHEMY_POTION") {
        alchemy.potions.push(ALCHEMY_POTIONS[Math.floor(Math.random() * ALCHEMY_POTIONS.length)]);
      }
      if (cmd.type === "BUY_UNDERGROUND_ITEM") {
        const item = UNDERGROUND_ITEMS[cmd.itemId];
        if (!item) throw new Error("Item is not in the Underground Market catalog");
        if (gold < item.costGold) throw new Error("Not enough gold");
        gold -= item.costGold;
        if (cmd.itemId === "reagent_kit") {
          alchemy.reagentKitUsesRemaining = (alchemy.reagentKitUsesRemaining ?? 0) + 5;
        } else {
          const existing = consumables.find((entry) => entry.itemId === cmd.itemId);
          if (existing) existing.quantity += 1;
          else consumables.push({ instanceId: crypto.randomUUID().slice(0, 8), itemId: cmd.itemId, quantity: 1, name: item.name, effect: item.description });
        }
      }
      if (cmd.type === "USE_HIDEOUT_REST") {
        const campaign = await getCampaignById(db, hero.campaignId);
        const activeSessionId = cmd.sessionId ?? campaign.currentSessionId;
        if (!activeSessionId) throw new Error("Hideout rest requires an active session");
        const session = await getSessionById(db, activeSessionId);
        if (!session) throw new Error("Session not found");
        assertSessionInCampaign(session, hero.campaignId);
        const flags = { ...(session.sessionFlags ?? {}) };
        const restFlagKey = `hideoutRestUsedByHero:${hero.id}`;
        if (hero.hideoutRestUsedThisQuest || flags[restFlagKey] === true) throw new Error("Hideout rest already used for this hero in this quest");
        const restored = Math.floor(Math.random() * 6) + 1;
        const bpGain = Math.min(hero.bodyPointsMax - body, restored);
        const mpGain = Math.min(hero.mindPointsMax - mind, restored - bpGain);
        body += bpGain;
        mind += mpGain;
        flags[restFlagKey] = true;
        statusFlags.isDead = false;
        await db.prepare("UPDATE sessions SET session_flags_json = ? WHERE id = ?").bind(JSON.stringify(flags), activeSessionId).run();
        await db.prepare(
          "UPDATE heroes SET body_points_current = ?, mind_points_current = ?, hideout_rest_used_this_quest = 1, status_flags_json = ?, alchemy_json = ?, consumables_json = ?, gold = ?, updated_at = ? WHERE id = ?"
        ).bind(body, mind, JSON.stringify(statusFlags), JSON.stringify(alchemy), JSON.stringify(consumables), gold, nowIso(), hero.id).run();
        await refresh(notify, hero.campaignId, activeSessionId);
        return;
      }
      await db.prepare(
        "UPDATE heroes SET alchemy_json = ?, consumables_json = ?, gold = ?, status_flags_json = ?, updated_at = ? WHERE id = ?"
      ).bind(JSON.stringify(alchemy), JSON.stringify(consumables), gold, JSON.stringify(statusFlags), nowIso(), hero.id).run();
      await refresh(notify, hero.campaignId, cmd.sessionId);
      return;
    }
    default:
      throw new Error("Unknown command");
  }
}
