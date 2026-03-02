import type { Server, Socket } from "socket.io";
import { customAlphabet } from "nanoid";
import { SessionModel } from "../models/Session";
import { HeroModel } from "../models/Hero";
import { CampaignModel } from "../models/Campaign";
import { PartyModel } from "../models/Party";
import type { SocketCommand, EffectiveRules } from "@hq/shared";
import { MONSTER_TYPES, QUESTS, GEAR_CATALOG, ITEM_CATALOG, HERO_SPELL_ACCESS, ALL_SPELL_ELEMENTS, resolveEffectiveRules, canEquipItem } from "@hq/shared";
import type { PackId } from "@hq/shared";
import { docToJson } from "../utils/docToJson";
import { ensureHeroStateShape } from "../utils/heroState";
import { buildSnapshotForSocket } from "./snapshot";

const nanoidEquip = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 8);

const MERCENARY_STATS: Record<string, { name: string; costGold: number; bodyPointsMax: number }> = {
  scout: { name: "Scout", costGold: 75, bodyPointsMax: 1 },
  guardian: { name: "Guardian", costGold: 100, bodyPointsMax: 2 },
  crossbowman: { name: "Crossbowman", costGold: 125, bodyPointsMax: 2 },
  swordsman: { name: "Swordsman", costGold: 150, bodyPointsMax: 2 },
};

const ALCHEMY_POTIONS = ["healing_tonic", "stone_draught", "smoke_elixir", "mind_ward"];

function ensurePartyShape(party: any): void {
  if (!Array.isArray(party.unlockedMercenaryTypes)) party.unlockedMercenaryTypes = [];
  if (!Array.isArray(party.mercenaries)) party.mercenaries = [];
  if (typeof party.reputationTokens !== "number") party.reputationTokens = 0;
}

export function registerSocketHandlers(io: Server, socket: Socket) {
  socket.on("command", async (cmd: SocketCommand) => {
    try {
      switch (cmd.type) {
        case "ADJUST_POINTS":
          await handleAdjustPoints(io, socket, cmd);
          break;
        case "SELECT_HERO":
          await handleSelectHero(io, socket, cmd);
          break;
        case "SELECT_SPELL":
          await handleSelectSpell(io, socket, cmd);
          break;
        case "SET_ROOM_STATE":
          await handleSetRoomState(io, socket, cmd);
          break;
        case "USE_ITEM":
          await handleUseItem(io, socket, cmd);
          break;
        case "SPAWN_MONSTER":
          await handleSpawnMonster(io, socket, cmd);
          break;
        case "REMOVE_MONSTER":
          await handleRemoveMonster(io, socket, cmd);
          break;
        case "ROLL_DICE":
          // Broadcast dice roll to all clients in the campaign (ephemeral — no DB save)
          io.to(`campaign:${socket.data.campaignId}`).emit("dice_roll", cmd);
          break;
        case "ADD_GOLD":
          await handleAddGold(io, socket, cmd);
          break;
        case "EQUIP_ITEM":
          await handleEquipItem(io, socket, cmd);
          break;
        case "UNEQUIP_ITEM":
          await handleUnequipItem(io, socket, cmd);
          break;
        case "ADD_CONSUMABLE":
          await handleAddConsumable(io, socket, cmd);
          break;
        case "START_SESSION":
          await handleStartSession(io, socket, cmd);
          break;
        case "END_SESSION":
          await handleEndSession(io, socket, cmd);
          break;
        case "SET_QUEST_STATUS":
          await handleSetQuestStatus(io, socket, cmd);
          break;
        case "REQUEST_SNAPSHOT":
          await handleRequestSnapshot(socket, cmd);
          break;
        case "SET_HERO_DISGUISE":
          await handleSetHeroDisguise(io, socket, cmd);
          break;
        case "ADJUST_REPUTATION":
          await handleAdjustReputation(io, socket, cmd);
          break;
        case "UNLOCK_MERCENARY_TYPE":
          await handleUnlockMercenaryType(io, socket, cmd);
          break;
        case "HIRE_MERCENARY":
          await handleHireMercenary(io, socket, cmd);
          break;
        case "DISMISS_MERCENARY":
          await handleDismissMercenary(io, socket, cmd);
          break;
        case "ADJUST_MERCENARY_POINTS":
          await handleAdjustMercenaryPoints(io, socket, cmd);
          break;
        case "ADD_REAGENT":
          await handleAddReagent(io, socket, cmd);
          break;
        case "REMOVE_REAGENT":
          await handleRemoveReagent(io, socket, cmd);
          break;
        case "CRAFT_POTION":
          await handleCraftPotion(io, socket, cmd);
          break;
        case "DRAW_RANDOM_ALCHEMY_POTION":
          await handleDrawRandomAlchemyPotion(io, socket, cmd);
          break;
        case "SET_MONSTER_STATUS":
          await handleSetMonsterStatus(io, socket, cmd);
          break;
        case "BUY_UNDERGROUND_ITEM":
          await handleBuyUndergroundItem(io, socket, cmd);
          break;
        case "USE_HIDEOUT_REST":
          await handleUseHideoutRest(io, socket, cmd);
          break;
        default:
          socket.emit("error", { message: "Unknown command" });
      }
    } catch (err) {
      console.error("[socket] Command error:", err);
      socket.emit("error", { message: "Command failed" });
    }
  });
}

async function handleRequestSnapshot(socket: Socket, cmd: Extract<SocketCommand, { type: "REQUEST_SNAPSHOT" }>) {
  const snapshot = await buildSnapshotForSocket(socket, cmd.sessionId);
  socket.emit("state_update", { type: "SYNC_SNAPSHOT", snapshot });
}

async function getSessionRules(campaignId: string, socketSessionId?: string): Promise<EffectiveRules | null> {
  const sessionId = socketSessionId ?? undefined;
  if (sessionId) {
    const session = await SessionModel.findById(sessionId);
    if (session && session.campaignId === campaignId) {
      return session.rulesSnapshot as unknown as EffectiveRules;
    }
  }

  const campaign = await CampaignModel.findById(campaignId);
  if (!campaign) return null;
  if (campaign.currentSessionId) {
    const active = await SessionModel.findById(campaign.currentSessionId);
    if (active) return active.rulesSnapshot as unknown as EffectiveRules;
  }
  return resolveEffectiveRules(campaign.enabledPacks as PackId[]);
}

async function requireEnabledSystem(
  socket: Socket,
  system: keyof EffectiveRules["enabledSystems"],
): Promise<EffectiveRules | null> {
  const rules = await getSessionRules(socket.data.campaignId as string, socket.data.sessionId as string | undefined);
  if (!rules) {
    socket.emit("error", { message: "Rules are unavailable for this campaign" });
    return null;
  }
  if (!rules.enabledSystems[system]) {
    socket.emit("error", { message: `System not enabled: ${system}` });
    return null;
  }
  return rules;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleAdjustPoints(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "ADJUST_POINTS" }>) {
  const { entityType, entityId, pool, delta } = cmd;

  if (entityType === "hero") {
    const hero = await HeroModel.findById(entityId);
    if (!hero) return socket.emit("error", { message: "Hero not found" });
    if (ensureHeroStateShape(hero)) await hero.save();

    // Authorization: GM can adjust any hero; players only their own
    if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
      return socket.emit("error", { message: "Not authorized to adjust this hero" });
    }

    if (pool === "BP") {
      hero.bodyPointsCurrent = Math.max(0, Math.min(hero.bodyPointsMax, hero.bodyPointsCurrent + delta));
      hero.statusFlags.isDead = hero.bodyPointsCurrent === 0;
    } else {
      hero.mindPointsCurrent = Math.max(0, Math.min(hero.mindPointsMax, hero.mindPointsCurrent + delta));
      hero.statusFlags.isInShock = hero.mindPointsCurrent === 0;
    }
    await hero.save();

    io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
  } else {
    // Monster adjustments are GM-only
    if (socket.data.role !== "gm") {
      return socket.emit("error", { message: "Only GM can adjust monster stats" });
    }

    const sessionId = socket.data.sessionId as string;
    const session = await SessionModel.findById(sessionId);
    if (!session) return socket.emit("error", { message: "Session not found" });

    const monster = session.monsters.find((m) => m.id === entityId);
    if (!monster) return socket.emit("error", { message: "Monster not found" });

    if (pool === "BP") {
      monster.bodyPointsCurrent = Math.max(0, Math.min(monster.bodyPointsMax, monster.bodyPointsCurrent + delta));
    } else if (pool === "MP" && monster.mindPointsCurrent !== undefined) {
      monster.mindPointsCurrent = Math.max(0, monster.mindPointsCurrent + delta);
    }

    await session.save();
    io.to(`session:${sessionId}`).emit("state_update", { type: "SESSION_UPDATED", session: docToJson(session) });
  }
}

// SELECT_HERO — lobby broadcast so other players see who has claimed a hero type
async function handleSelectHero(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "SELECT_HERO" }>) {
  const { sessionId, playerId, heroTypeId, heroName } = cmd;
  const session = await SessionModel.findById(sessionId);
  if (!session) return socket.emit("error", { message: "Session not found" });

  const rules = session.rulesSnapshot as unknown as EffectiveRules;
  if (!rules.allowedHeroes.includes(heroTypeId)) {
    return socket.emit("error", { message: `Hero type ${heroTypeId} is not allowed for this quest` });
  }

  // Enforce uniqueHeroesOnly: reject if another player already has this type
  if (rules.constraints.uniqueHeroesOnly) {
    const taken = await HeroModel.findOne({ campaignId: session.campaignId, heroTypeId });
    if (taken) {
      return socket.emit("error", { message: `A ${heroTypeId} has already been claimed` });
    }
  }

  io.to(`session:${sessionId}`).emit("state_update", { type: "HERO_SELECTED", playerId, heroTypeId, heroName });
}

async function handleSelectSpell(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "SELECT_SPELL" }>) {
  const { heroId, spell, chosen } = cmd;
  const hero = await HeroModel.findById(heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();

  // Authorization: GM or owning player
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized" });
  }

  const rules = await getSessionRules(hero.campaignId, socket.data.sessionId as string | undefined);
  if (rules?.enabledSystems.disguises && hero.statusFlags.isDisguised) {
    return socket.emit("error", { message: "Cannot cast or prepare spells while disguised" });
  }

  const access = HERO_SPELL_ACCESS[hero.heroTypeId as keyof typeof HERO_SPELL_ACCESS];
  const limit = access?.elementLimit;
  if (!limit) return socket.emit("error", { message: "This hero cannot cast spells" });

  if (chosen) {
    if (!hero.spellsChosenThisQuest.includes(spell)) {
      if (hero.spellsChosenThisQuest.length >= limit) {
        return socket.emit("error", { message: `Can only select ${limit} spells` });
      }
      hero.spellsChosenThisQuest.push(spell);
    }
  } else {
    hero.spellsChosenThisQuest = hero.spellsChosenThisQuest.filter((s) => s !== spell) as any;
  }

  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });

  // Phase 3 auto-assign: when Elf finishes picking their 1 element,
  // find the Wizard in the same campaign and assign the remaining unchosen element.
  if (chosen && hero.heroTypeId === "elf" && hero.spellsChosenThisQuest.length === 1) {
    const wizard = await HeroModel.findOne({ campaignId: hero.campaignId, heroTypeId: "wizard" });
    if (wizard && wizard.spellsChosenThisQuest.length === 2) {
      const taken = new Set([...wizard.spellsChosenThisQuest, ...hero.spellsChosenThisQuest]);
      const remaining = ALL_SPELL_ELEMENTS.find((e) => !taken.has(e));
      if (remaining) {
        (wizard.spellsChosenThisQuest as any).push(remaining);
        await wizard.save();
        io.to(`campaign:${wizard.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(wizard) });
      }
    }
  }
}

async function handleSetRoomState(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "SET_ROOM_STATE" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can reveal rooms" });
  }

  const { sessionId, roomId, state } = cmd;
  const session = await SessionModel.findById(sessionId);
  if (!session) return socket.emit("error", { message: "Session not found" });

  const existing = session.rooms.find((r) => r.roomId === roomId);
  const wasHidden = !existing || existing.state === "hidden";

  if (existing) {
    existing.state = state;
  } else {
    session.rooms.push({ roomId, state });
  }

  // Auto-spawn monsters on first reveal (hidden → revealed only)
  if (state === "revealed" && wasHidden) {
    const quest = QUESTS.find((q) => q.id === (session as any).questId);
    const rules = quest?.roomSpawns?.[roomId] ?? [];
    for (const rule of rules) {
      const mt = MONSTER_TYPES.find((m) => m.id === rule.monsterTypeId);
      if (!mt) continue;
      const existingCount = (session.monsters as any[]).filter(
        (m) => m.monsterTypeId === rule.monsterTypeId
      ).length;
      for (let i = 0; i < rule.count; i++) {
        (session.monsters as any).push({
          id: `${rule.monsterTypeId}-${Date.now()}-${i}`,
          monsterTypeId: rule.monsterTypeId,
          label: `${mt.name} ${existingCount + i + 1}`,
          bodyPointsCurrent: mt.bodyPointsMax,
          bodyPointsMax: mt.bodyPointsMax,
          mindPointsCurrent: mt.mindPointsCurrent,
          roomId,
        });
      }
    }
  }

  await session.save();

  io.to(`session:${sessionId}`).emit("state_update", { type: "SESSION_UPDATED", session: docToJson(session) });
}

async function handleUseItem(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "USE_ITEM" }>) {
  const { heroId, itemId } = cmd;
  const hero = await HeroModel.findById(heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();

  // Authorization: GM or owning player
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized to use items for this hero" });
  }

  const itemIdx = hero.consumables.findIndex((i: any) => i.instanceId === itemId || i.id === itemId);
  if (itemIdx === -1) return socket.emit("error", { message: "Consumable not found in hero inventory" });

  const item = hero.consumables[itemIdx] as any;
  const catalogItem = ITEM_CATALOG.find((g) => g.id === item.itemId);

  if (item.quantity <= 1) {
    hero.consumables.splice(itemIdx, 1);
  } else {
    item.quantity -= 1;
  }

  // Apply the consumable's effect
  if (catalogItem) {
    if (catalogItem.id === "healing_potion") {
      hero.bodyPointsCurrent = Math.min(hero.bodyPointsMax, hero.bodyPointsCurrent + 4);
    } else if (catalogItem.id === "healing_herb") {
      hero.bodyPointsCurrent = Math.min(hero.bodyPointsMax, hero.bodyPointsCurrent + 2);
    } else if (catalogItem.id === "holy_water") {
      hero.statusFlags.isInShock = false;
      if (hero.mindPointsCurrent === 0) hero.mindPointsCurrent = 1;
    }
    hero.statusFlags.isDead = hero.bodyPointsCurrent === 0;
  }

  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleSpawnMonster(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "SPAWN_MONSTER" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can spawn monsters" });
  }

  const { sessionId, monsterTypeId, label, roomId, bodyPointsMax, mindPointsCurrent } = cmd;

  // Validate monster type
  const monsterType = MONSTER_TYPES.find((m) => m.id === monsterTypeId);
  if (!monsterType) return socket.emit("error", { message: `Unknown monster type: ${monsterTypeId}` });

  const session = await SessionModel.findById(sessionId);
  if (!session) return socket.emit("error", { message: "Session not found" });

  const id = `${monsterTypeId}-${Date.now()}`;
  session.monsters.push({
    id,
    monsterTypeId,
    label,
    bodyPointsCurrent: bodyPointsMax,
    bodyPointsMax,
    mindPointsCurrent,
    roomId,
  } as any);
  await session.save();

  io.to(`session:${sessionId}`).emit("state_update", { type: "SESSION_UPDATED", session: docToJson(session) });
}

async function handleRemoveMonster(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "REMOVE_MONSTER" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can remove monsters" });
  }

  const { sessionId, monsterId } = cmd;
  const session = await SessionModel.findById(sessionId);
  if (!session) return socket.emit("error", { message: "Session not found" });

  session.monsters = session.monsters.filter((m: any) => m.id !== monsterId) as any;
  await session.save();

  io.to(`session:${sessionId}`).emit("state_update", { type: "SESSION_UPDATED", session: docToJson(session) });
}

async function handleAddGold(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "ADD_GOLD" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can adjust gold" });
  }

  const { heroId, amount } = cmd;
  const hero = await HeroModel.findById(heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();

  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }

  hero.gold = Math.max(0, hero.gold + amount);
  await hero.save();

  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleEquipItem(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "EQUIP_ITEM" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can equip items" });
  }

  const { heroId, itemId, slot } = cmd;

  const item = ITEM_CATALOG.find((i) => i.id === itemId);
  if (!item) return socket.emit("error", { message: `Unknown item: ${itemId}` });
  if (!item.equipSlot) return socket.emit("error", { message: "This item cannot be equipped" });
  if (item.equipSlot !== slot) {
    return socket.emit("error", { message: `Illegal slot: ${item.name} must be equipped in ${item.equipSlot}` });
  }

  const hero = await HeroModel.findById(heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();

  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }

  const rules = await getSessionRules(hero.campaignId, socket.data.sessionId as string | undefined);
  if (!rules) return socket.emit("error", { message: "Rules unavailable" });

  const heroPlain = docToJson(hero) as import("@hq/shared").Hero;
  const result = canEquipItem(heroPlain, item, rules);
  if (!result.ok) return socket.emit("error", { message: result.reason });

  const equipped = (hero as any).equipped ?? {};
  const currentlyEquipped = equipped[slot];
  if (currentlyEquipped?.itemId) {
    const currentDef = ITEM_CATALOG.find((i) => i.id === currentlyEquipped.itemId);
    if (currentDef?.category === "artifact") {
      const hasArtifact = ((hero as any).artifacts ?? []).some((a: any) => a.artifactId === currentlyEquipped.itemId);
      if (!hasArtifact) {
        ((hero as any).artifacts ??= []).push({ instanceId: nanoidEquip(), artifactId: currentlyEquipped.itemId });
      }
    } else {
      ((hero as any).inventory ??= []).push({ instanceId: nanoidEquip(), itemId: currentlyEquipped.itemId });
    }
  }

  let instanceId = nanoidEquip();
  if (item.category === "artifact") {
    const artifacts = ((hero as any).artifacts ??= []);
    const owned = artifacts.find((a: any) => a.artifactId === item.id);
    if (!owned) {
      artifacts.push({ instanceId, artifactId: item.id });
    } else {
      instanceId = owned.instanceId;
    }
  } else {
    const inventory = ((hero as any).inventory ??= []);
    const idx = inventory.findIndex((inv: any) => inv.itemId === item.id);
    if (idx !== -1) {
      instanceId = inventory[idx].instanceId;
      inventory.splice(idx, 1);
    }
  }

  (hero as any).equipped = equipped;
  (hero as any).equipped[slot] = { instanceId, itemId };
  hero.markModified("equipped");
  hero.markModified("inventory");
  hero.markModified("artifacts");
  await hero.save();

  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleUnequipItem(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "UNEQUIP_ITEM" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can unequip items" });
  }

  const { heroId, slot } = cmd;
  const hero = await HeroModel.findById(heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();

  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }

  if ((hero as any).equipped) {
    const equippedEntry = (hero as any).equipped[slot];
    if (equippedEntry?.itemId) {
      const def = ITEM_CATALOG.find((i) => i.id === equippedEntry.itemId);
      if (def?.category !== "artifact") {
        ((hero as any).inventory ??= []).push({ instanceId: equippedEntry.instanceId ?? nanoidEquip(), itemId: equippedEntry.itemId });
        hero.markModified("inventory");
      }
    }
    delete (hero as any).equipped[slot];
    hero.markModified("equipped");
  }
  await hero.save();

  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleAddConsumable(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "ADD_CONSUMABLE" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can add consumables" });
  }

  const { heroId, name, quantity = 1, effect } = cmd;
  const hero = await HeroModel.findById(heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();

  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }

  const catalogMatch = GEAR_CATALOG.find((g) => g.category === "consumable" && g.name === name);
  (hero.consumables as any).push({
    instanceId: nanoidEquip(),
    itemId: catalogMatch?.id ?? "custom_consumable",
    name,
    quantity,
    effect: effect ?? catalogMatch?.description,
  });
  await hero.save();

  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleStartSession(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "START_SESSION" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can start a session" });
  }

  const campaignId = socket.data.campaignId as string;
  const { questId } = cmd;

  const campaign = await CampaignModel.findById(campaignId);
  if (!campaign) return socket.emit("error", { message: "Campaign not found" });

  if (campaign._id.toString() !== campaignId) {
    return socket.emit("error", { message: "Forbidden" });
  }

  const quest = QUESTS.find((q) => q.id === questId);
  if (!quest) return socket.emit("error", { message: "Quest not found" });

  const pack = campaign.enabledPacks.find((p) => p === quest.packId) as PackId | undefined;
  if (!pack) return socket.emit("error", { message: `Pack ${quest.packId} not enabled for this campaign` });

  const rulesSnapshot = resolveEffectiveRules(campaign.enabledPacks as PackId[], quest);

  const session = await SessionModel.create({
    campaignId,
    questId,
    startedAt: new Date(),
    rooms: [],
    monsters: [],
    rulesSnapshot,
  });

  await CampaignModel.findByIdAndUpdate(campaignId, { currentSessionId: session._id.toString() });
  const updatedCampaign = await CampaignModel.findById(campaignId);

  io.to(`campaign:${campaignId}`).emit("state_update", {
    type: "SESSION_STARTED",
    session: docToJson(session),
    campaign: docToJson(updatedCampaign),
  });
}

async function handleEndSession(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "END_SESSION" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can end a session" });
  }

  const { sessionId } = cmd;
  const session = await SessionModel.findByIdAndUpdate(
    sessionId,
    { endedAt: new Date() },
    { new: true }
  );
  if (!session) return socket.emit("error", { message: "Session not found" });

  if (session.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: session is not in your campaign" });
  }

  await CampaignModel.findOneAndUpdate(
    { currentSessionId: sessionId },
    { $unset: { currentSessionId: 1 } }
  );

  // Reset all heroes: restore full HP/MP, clear per-quest status flags and spell selections
  await HeroModel.updateMany(
    { campaignId: session.campaignId },
    {
      $set: {
        "statusFlags.isDead": false,
        "statusFlags.isInShock": false,
        "statusFlags.isDisguised": false,
        "statusFlags.hasDisguiseToken": false,
        hideoutRestUsedThisQuest: false,
      },
      $unset: { spellsChosenThisQuest: 1, "statusFlags.disguiseBrokenReason": 1 },
    }
  );
  const heroes = await HeroModel.find({ campaignId: session.campaignId });
  await Promise.all(
    heroes.map((h) =>
      HeroModel.findByIdAndUpdate(h._id, {
        bodyPointsCurrent: h.bodyPointsMax,
        mindPointsCurrent: h.mindPointsMax,
      })
    )
  );

  const updatedCampaign = await CampaignModel.findById(session.campaignId);

  io.to(`campaign:${session.campaignId}`).emit("state_update", {
    type: "SESSION_ENDED",
    session: docToJson(session),
    campaign: docToJson(updatedCampaign),
  });
}

async function handleSetHeroDisguise(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "SET_HERO_DISGUISE" }>) {
  const rules = await requireEnabledSystem(socket, "disguises");
  if (!rules) return;

  const hero = await HeroModel.findById(cmd.heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }
  if (ensureHeroStateShape(hero)) await hero.save();

  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized to change disguise state" });
  }

  hero.statusFlags.isDisguised = cmd.isDisguised;
  hero.statusFlags.hasDisguiseToken = cmd.isDisguised;
  if (!cmd.isDisguised) {
    hero.statusFlags.disguiseBrokenReason = undefined;
  }
  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleAdjustReputation(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "ADJUST_REPUTATION" }>) {
  const rules = await requireEnabledSystem(socket, "reputationTokens");
  if (!rules) return;
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can adjust reputation" });
  }

  const campaign = await CampaignModel.findById(socket.data.campaignId);
  if (!campaign) return socket.emit("error", { message: "Campaign not found" });
  const party = await PartyModel.findById(campaign.partyId);
  if (!party) return socket.emit("error", { message: "Party not found" });
  ensurePartyShape(party);

  party.reputationTokens = Math.max(0, (party.reputationTokens ?? 0) + cmd.amount);
  await party.save();
  io.to(`campaign:${party.campaignId}`).emit("state_update", { type: "PARTY_UPDATED", party: docToJson(party) });
}

async function handleUnlockMercenaryType(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "UNLOCK_MERCENARY_TYPE" }>) {
  const rules = await requireEnabledSystem(socket, "mercenaries");
  if (!rules) return;
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can unlock mercenary types" });
  }

  const campaign = await CampaignModel.findById(socket.data.campaignId);
  if (!campaign) return socket.emit("error", { message: "Campaign not found" });
  const party = await PartyModel.findById(campaign.partyId);
  if (!party) return socket.emit("error", { message: "Party not found" });
  ensurePartyShape(party);

  if (!(party.unlockedMercenaryTypes as string[]).includes(cmd.mercenaryTypeId)) {
    party.unlockedMercenaryTypes.push(cmd.mercenaryTypeId as any);
    await party.save();
  }
  io.to(`campaign:${party.campaignId}`).emit("state_update", { type: "PARTY_UPDATED", party: docToJson(party) });
}

async function handleHireMercenary(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "HIRE_MERCENARY" }>) {
  const rules = await requireEnabledSystem(socket, "mercenaries");
  if (!rules) return;
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can hire mercenaries" });
  }

  const campaign = await CampaignModel.findById(socket.data.campaignId);
  if (!campaign) return socket.emit("error", { message: "Campaign not found" });
  const party = await PartyModel.findById(campaign.partyId);
  if (!party) return socket.emit("error", { message: "Party not found" });
  ensurePartyShape(party);

  if (!(party.unlockedMercenaryTypes as string[]).includes(cmd.mercenaryTypeId)) {
    return socket.emit("error", { message: "Mercenary type is not unlocked" });
  }
  if ((party.mercenaries as any[]).some((m) => m.mercenaryTypeId === cmd.mercenaryTypeId)) {
    return socket.emit("error", { message: "Only one of each mercenary type can be hired per quest" });
  }

  const hero = await HeroModel.findById(cmd.heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });

  const mercDef = MERCENARY_STATS[cmd.mercenaryTypeId];
  if (!mercDef) return socket.emit("error", { message: "Unknown mercenary type" });

  if (cmd.payWith === "reputation") {
    if ((party.reputationTokens ?? 0) < 1) return socket.emit("error", { message: "Not enough reputation tokens" });
    party.reputationTokens -= 1;
  } else {
    if ((hero.gold ?? 0) < mercDef.costGold) return socket.emit("error", { message: "Not enough gold" });
    hero.gold -= mercDef.costGold;
    await hero.save();
    io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
  }

  (party.mercenaries as any).push({
    id: nanoidEquip(),
    mercenaryTypeId: cmd.mercenaryTypeId,
    name: mercDef.name,
    bodyPointsCurrent: mercDef.bodyPointsMax,
    bodyPointsMax: mercDef.bodyPointsMax,
    hiredByHeroId: cmd.heroId,
  });
  await party.save();

  io.to(`campaign:${party.campaignId}`).emit("state_update", { type: "PARTY_UPDATED", party: docToJson(party) });
}

async function handleDismissMercenary(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "DISMISS_MERCENARY" }>) {
  const rules = await requireEnabledSystem(socket, "mercenaries");
  if (!rules) return;
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can dismiss mercenaries" });
  }

  const campaign = await CampaignModel.findById(socket.data.campaignId);
  if (!campaign) return socket.emit("error", { message: "Campaign not found" });
  const party = await PartyModel.findById(campaign.partyId);
  if (!party) return socket.emit("error", { message: "Party not found" });
  ensurePartyShape(party);

  party.mercenaries = (party.mercenaries as any).filter((m: any) => m.id !== cmd.mercenaryId);
  await party.save();
  io.to(`campaign:${party.campaignId}`).emit("state_update", { type: "PARTY_UPDATED", party: docToJson(party) });
}

async function handleAdjustMercenaryPoints(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "ADJUST_MERCENARY_POINTS" }>) {
  const rules = await requireEnabledSystem(socket, "mercenaries");
  if (!rules) return;
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can adjust mercenary points" });
  }

  const campaign = await CampaignModel.findById(socket.data.campaignId);
  if (!campaign) return socket.emit("error", { message: "Campaign not found" });
  const party = await PartyModel.findById(campaign.partyId);
  if (!party) return socket.emit("error", { message: "Party not found" });
  ensurePartyShape(party);

  const mercenary = (party.mercenaries as any[]).find((m) => m.id === cmd.mercenaryId);
  if (!mercenary) return socket.emit("error", { message: "Mercenary not found" });
  mercenary.bodyPointsCurrent = Math.max(0, Math.min(mercenary.bodyPointsMax, mercenary.bodyPointsCurrent + cmd.delta));
  await party.save();
  io.to(`campaign:${party.campaignId}`).emit("state_update", { type: "PARTY_UPDATED", party: docToJson(party) });
}

async function handleAddReagent(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "ADD_REAGENT" }>) {
  const rules = await requireEnabledSystem(socket, "alchemy");
  if (!rules) return;
  const hero = await HeroModel.findById(cmd.heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();
  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized" });
  }
  (hero.alchemy ??= { reagents: [], potions: [] }).reagents.push(cmd.reagentId);
  hero.markModified("alchemy");
  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleRemoveReagent(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "REMOVE_REAGENT" }>) {
  const rules = await requireEnabledSystem(socket, "alchemy");
  if (!rules) return;
  const hero = await HeroModel.findById(cmd.heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();
  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized" });
  }
  const idx = (hero.alchemy?.reagents ?? []).findIndex((r) => r === cmd.reagentId);
  if (idx === -1) return socket.emit("error", { message: "Reagent not found" });
  hero.alchemy!.reagents.splice(idx, 1);
  hero.markModified("alchemy");
  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleCraftPotion(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "CRAFT_POTION" }>) {
  const rules = await requireEnabledSystem(socket, "alchemy");
  if (!rules) return;
  const hero = await HeroModel.findById(cmd.heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();
  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized" });
  }

  const alchemy = (hero.alchemy ??= { reagents: [], potions: [] });
  for (const reagentId of cmd.consumeReagentIds) {
    const idx = alchemy.reagents.findIndex((r) => r === reagentId);
    if (idx === -1) return socket.emit("error", { message: `Missing reagent: ${reagentId}` });
    alchemy.reagents.splice(idx, 1);
  }
  if (cmd.useReagentKit) {
    const uses = alchemy.reagentKitUsesRemaining ?? 0;
    if (uses <= 0) return socket.emit("error", { message: "No reagent kit uses remaining" });
    alchemy.reagentKitUsesRemaining = uses - 1;
  }
  alchemy.potions.push(cmd.potionId);
  hero.markModified("alchemy");
  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleDrawRandomAlchemyPotion(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "DRAW_RANDOM_ALCHEMY_POTION" }>) {
  const rules = await requireEnabledSystem(socket, "alchemy");
  if (!rules) return;
  const hero = await HeroModel.findById(cmd.heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();
  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized" });
  }
  const randomPotion = ALCHEMY_POTIONS[Math.floor(Math.random() * ALCHEMY_POTIONS.length)];
  (hero.alchemy ??= { reagents: [], potions: [] }).potions.push(randomPotion);
  hero.markModified("alchemy");
  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleSetMonsterStatus(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "SET_MONSTER_STATUS" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can update monster statuses" });
  }
  if (cmd.status === "isEthereal") {
    const rules = await requireEnabledSystem(socket, "etherealMonsters");
    if (!rules) return;
  }
  const session = await SessionModel.findById(cmd.sessionId);
  if (!session) return socket.emit("error", { message: "Session not found" });
  const monster = (session.monsters as any[]).find((m) => m.id === cmd.monsterId);
  if (!monster) return socket.emit("error", { message: "Monster not found" });
  monster.statusFlags = monster.statusFlags ?? {};
  monster.statusFlags[cmd.status] = cmd.value;
  await session.save();
  io.to(`session:${cmd.sessionId}`).emit("state_update", { type: "SESSION_UPDATED", session: docToJson(session) });
}

async function handleBuyUndergroundItem(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "BUY_UNDERGROUND_ITEM" }>) {
  const rules = await requireEnabledSystem(socket, "undergroundMarket");
  if (!rules) return;
  const hero = await HeroModel.findById(cmd.heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();
  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized" });
  }

  const item = ITEM_CATALOG.find((i) => i.id === cmd.itemId);
  if (!item) return socket.emit("error", { message: "Unknown market item" });
  if (!["caltrops", "smoke_bomb", "reagent_kit"].includes(item.id)) {
    return socket.emit("error", { message: "Item is not in the Underground Market catalog" });
  }

  const cost = item.costGold ?? 0;
  if ((hero.gold ?? 0) < cost) return socket.emit("error", { message: "Not enough gold" });
  hero.gold -= cost;

  if (item.id === "reagent_kit") {
    hero.alchemy ??= { reagents: [], potions: [], reagentKitUsesRemaining: 0 };
    hero.alchemy.reagentKitUsesRemaining = (hero.alchemy.reagentKitUsesRemaining ?? 0) + 5;
    hero.markModified("alchemy");
  } else {
    const existing = hero.consumables.find((c: any) => c.itemId === item.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      hero.consumables.push({ instanceId: nanoidEquip(), itemId: item.id, quantity: 1, name: item.name, effect: item.description } as any);
    }
    hero.markModified("consumables");
  }
  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleUseHideoutRest(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "USE_HIDEOUT_REST" }>) {
  const rules = await requireEnabledSystem(socket, "hideouts");
  if (!rules) return;
  const hero = await HeroModel.findById(cmd.heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });
  if (ensureHeroStateShape(hero)) await hero.save();
  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized" });
  }
  if (hero.hideoutRestUsedThisQuest) {
    return socket.emit("error", { message: "Hideout rest already used for this hero in this quest" });
  }

  const restored = Math.floor(Math.random() * 6) + 1;
  const bpMissing = hero.bodyPointsMax - hero.bodyPointsCurrent;
  const bpGain = Math.min(bpMissing, restored);
  const mpGain = Math.min(hero.mindPointsMax - hero.mindPointsCurrent, restored - bpGain);
  hero.bodyPointsCurrent += bpGain;
  hero.mindPointsCurrent += mpGain;
  hero.hideoutRestUsedThisQuest = true;
  hero.statusFlags.isDead = false;
  hero.statusFlags.isInShock = hero.mindPointsCurrent === 0;
  await hero.save();
  io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });
}

async function handleSetQuestStatus(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "SET_QUEST_STATUS" }>) {
  if (socket.data.role !== "gm") {
    return socket.emit("error", { message: "Only GM can update quest status" });
  }

  const campaignId = socket.data.campaignId as string;
  const { questId, status } = cmd;

  const campaign = await CampaignModel.findById(campaignId);
  if (!campaign) return socket.emit("error", { message: "Campaign not found" });

  const entry = campaign.questLog.find((q) => q.questId === questId);
  if (!entry) return socket.emit("error", { message: "Quest not in log" });

  entry.status = status;
  if (status === "completed") {
    entry.completedAt = new Date();
    // Auto-unlock the next quest in the log
    const idx = campaign.questLog.findIndex((q) => q.questId === questId);
    const next = campaign.questLog[idx + 1];
    if (next && next.status === "locked") next.status = "available";

    // Reset spell selections for all heroes — new quest means new spell picks
    await HeroModel.updateMany({ campaignId }, { $set: { spellsChosenThisQuest: [] } });
    const heroes = await HeroModel.find({ campaignId });
    for (const h of heroes) {
      io.to(`campaign:${campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(h) });
    }
  }
  await campaign.save();

  io.to(`campaign:${campaignId}`).emit("state_update", { type: "CAMPAIGN_UPDATED", campaign: docToJson(campaign) });
}
