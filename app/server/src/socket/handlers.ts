import type { Server, Socket } from "socket.io";
import { customAlphabet } from "nanoid";
import { SessionModel } from "../models/Session";
import { HeroModel } from "../models/Hero";
import { CampaignModel } from "../models/Campaign";
import type { SocketCommand, EffectiveRules } from "@hq/shared";
import { MONSTER_TYPES, QUESTS, GEAR_CATALOG, ITEM_CATALOG, HERO_SPELL_ACCESS, ALL_SPELL_ELEMENTS, resolveEffectiveRules, canEquipItem } from "@hq/shared";
import type { PackId } from "@hq/shared";
import { docToJson } from "../utils/docToJson";

const nanoidEquip = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 8);

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
        default:
          socket.emit("error", { message: "Unknown command" });
      }
    } catch (err) {
      console.error("[socket] Command error:", err);
      socket.emit("error", { message: "Command failed" });
    }
  });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleAdjustPoints(io: Server, socket: Socket, cmd: Extract<SocketCommand, { type: "ADJUST_POINTS" }>) {
  const { entityType, entityId, pool, delta } = cmd;

  if (entityType === "hero") {
    const hero = await HeroModel.findById(entityId);
    if (!hero) return socket.emit("error", { message: "Hero not found" });

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

  // Authorization: GM or owning player
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized" });
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

  // Authorization: GM or owning player
  if (socket.data.role !== "gm" && hero.playerId !== socket.data.playerId) {
    return socket.emit("error", { message: "Not authorized to use items for this hero" });
  }

  const itemIdx = hero.consumables.findIndex((i: any) => i.id === itemId);
  if (itemIdx === -1) return socket.emit("error", { message: "Item not found" });

  const item = hero.consumables[itemIdx] as any;
  if (item.quantity <= 1) {
    hero.consumables.splice(itemIdx, 1);
  } else {
    item.quantity -= 1;
  }

  // Apply the consumable's effect
  const catalogItem = GEAR_CATALOG.find((g) => g.name === item.name);
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

  const hero = await HeroModel.findById(heroId);
  if (!hero) return socket.emit("error", { message: "Hero not found" });

  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }

  const campaign = await CampaignModel.findById(hero.campaignId);
  if (!campaign) return socket.emit("error", { message: "Campaign not found" });

  const rules = resolveEffectiveRules(campaign.enabledPacks as PackId[]);

  const heroPlain = docToJson(hero) as import("@hq/shared").Hero;
  const result = canEquipItem(heroPlain, item, rules);
  if (!result.ok) return socket.emit("error", { message: result.reason });

  (hero as any).equipped = (hero as any).equipped ?? {};
  (hero as any).equipped[slot] = { instanceId: nanoidEquip(), itemId };
  hero.markModified("equipped");
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

  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }

  if ((hero as any).equipped) {
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

  if (hero.campaignId !== socket.data.campaignId) {
    return socket.emit("error", { message: "Forbidden: hero is not in your campaign" });
  }

  (hero.consumables as any).push({ id: nanoidEquip(), name, quantity, effect });
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
      },
      $unset: { spellsChosenThisQuest: 1 },
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
