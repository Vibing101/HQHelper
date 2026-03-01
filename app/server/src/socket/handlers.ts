import type { Server, Socket } from "socket.io";
import { SessionModel } from "../models/Session";
import { HeroModel } from "../models/Hero";
import type { SocketCommand, EffectiveRules } from "@hq/shared";
import { MONSTER_TYPES, QUESTS, GEAR_CATALOG, HERO_SPELL_ACCESS } from "@hq/shared";
import { docToJson } from "../utils/docToJson";

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
  const limit = access?.limit;
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
