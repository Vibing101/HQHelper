import { Router } from "express";
import { customAlphabet } from "nanoid";
import { HeroModel } from "../models/Hero";
import { PartyModel } from "../models/Party";
import { HERO_BASE_STATS } from "@hq/shared";
import type { HeroTypeId } from "@hq/shared";
import { docToJson } from "../utils/docToJson";
import type { Server } from "socket.io";
import { signToken } from "../auth";
import { requireToken } from "../middleware/requireToken";

const router = Router();
const nanoidEquip = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 8);

// ─── Ownership helper ─────────────────────────────────────────────────────────

/** Returns true when the token allows modifying the given hero. */
function canModifyHero(heroId: string, heroPlayerId: string, token: { role: string; heroId?: string; playerId?: string }): boolean {
  if (token.role === "gm") return true;
  // Player can only modify their own hero (matched by heroId claim in token)
  return token.heroId === heroId || token.playerId === heroPlayerId;
}

// ─── POST /api/heroes — create a hero (player token required) ─────────────────
//
// playerId and campaignId are sourced from the verified Bearer token, not the body.
// On success the response includes an updated token that now includes heroId,
// which the client should store and use for subsequent socket/REST calls.

router.post("/", requireToken(["player"]), async (req, res) => {
  try {
    const { heroTypeId, name, partyId } = req.body as {
      heroTypeId: HeroTypeId;
      name: string;
      partyId?: string;
    };

    const { campaignId, playerId } = req.tokenPayload!;

    if (!heroTypeId || !name) {
      return res.status(400).json({ error: "heroTypeId and name are required" });
    }
    if (!playerId) {
      return res.status(400).json({ error: "Token is missing playerId — re-join the campaign" });
    }

    const stats = HERO_BASE_STATS[heroTypeId];
    if (!stats) return res.status(400).json({ error: "Invalid heroTypeId" });

    // Enforce unique hero types per campaign (both packs use uniqueHeroesOnly: true)
    const existing = await HeroModel.findOne({ campaignId, heroTypeId });
    if (existing) {
      return res.status(409).json({ error: `A ${heroTypeId} already exists in this campaign` });
    }

    const hero = await HeroModel.create({
      heroTypeId,
      name,
      playerId,      // from token — never from client body
      campaignId,    // from token — never from client body
      ...stats,
      bodyPointsCurrent: stats.bodyPointsMax,
      mindPointsCurrent: stats.mindPointsMax,
      gold: 0,
      equipment: [],
      consumables: [],
      spellsChosenThisQuest: [],
      statusFlags: { isDead: false, isInShock: false, isDisguised: false },
    });

    if (partyId) {
      await PartyModel.findByIdAndUpdate(partyId, {
        $addToSet: { heroIds: hero._id.toString() },
      });
    }

    const io = req.app.get("io") as Server;
    io.to(`campaign:${campaignId}`).emit("state_update", { type: "HERO_CREATED", hero: docToJson(hero) });

    // Issue an updated token that now includes this player's heroId
    const token = signToken({ campaignId, role: "player", playerId, heroId: hero._id.toString() });

    return res.status(201).json({ hero: docToJson(hero), token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create hero" });
  }
});

// ─── POST /api/heroes/:id/claim — resume an existing hero (player token required) ─
//
// Issues an updated token with heroId so the player can use socket mutations
// on their previously created hero.  Verifies hero.playerId matches the token.

router.post("/:id/claim", requireToken(["player"]), async (req, res) => {
  try {
    const { campaignId, playerId } = req.tokenPayload!;

    if (!playerId) {
      return res.status(400).json({ error: "Token is missing playerId — re-join the campaign" });
    }

    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Hero not found" });

    if (hero.campaignId !== campaignId) {
      return res.status(403).json({ error: "Forbidden: hero is not in your campaign" });
    }

    if (hero.playerId && hero.playerId !== playerId) {
      return res.status(403).json({ error: "Forbidden: hero belongs to a different player" });
    }

    // Update playerId if hero was created without one (migration edge-case)
    if (!hero.playerId) {
      hero.playerId = playerId;
      await hero.save();
    }

    const token = signToken({ campaignId, role: "player", playerId, heroId: hero._id.toString() });
    return res.json({ hero: docToJson(hero), token });
  } catch (err) {
    return res.status(500).json({ error: "Failed to claim hero" });
  }
});

// ─── GET /api/heroes/campaign/:campaignId — list heroes (read-only, no auth) ──
// Must be before /:id to avoid route shadowing.
router.get("/campaign/:campaignId", async (req, res) => {
  try {
    const heroes = await HeroModel.find({ campaignId: req.params.campaignId });
    return res.json({ heroes: heroes.map(docToJson) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to list heroes" });
  }
});

// ─── GET /api/heroes/:id — load hero (read-only, no auth) ─────────────────────
router.get("/:id", async (req, res) => {
  try {
    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });
    return res.json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load hero" });
  }
});

// ─── PATCH /api/heroes/:id/gold — award or deduct gold (GM only) ──────────────
router.patch("/:id/gold", requireToken(["gm"]), async (req, res) => {
  try {
    const { amount } = req.body as { amount: number };
    if (typeof amount !== "number") return res.status(400).json({ error: "amount must be a number" });

    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });

    if (hero.campaignId !== req.tokenPayload!.campaignId) {
      return res.status(403).json({ error: "Forbidden: hero is not in your campaign" });
    }

    hero.gold = Math.max(0, hero.gold + amount);
    await hero.save();

    const io = req.app.get("io") as Server;
    io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });

    return res.json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update gold" });
  }
});

// ─── POST /api/heroes/:id/equipment — add an equipment item (GM only) ─────────
router.post("/:id/equipment", requireToken(["gm"]), async (req, res) => {
  try {
    const { name, attackBonus, defendBonus } = req.body as {
      name: string;
      attackBonus?: number;
      defendBonus?: number;
    };
    if (!name) return res.status(400).json({ error: "name is required" });

    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });

    if (hero.campaignId !== req.tokenPayload!.campaignId) {
      return res.status(403).json({ error: "Forbidden: hero is not in your campaign" });
    }

    (hero.equipment as any).push({ id: nanoidEquip(), name, attackBonus, defendBonus });
    await hero.save();

    const io = req.app.get("io") as Server;
    io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });

    return res.status(201).json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to add equipment" });
  }
});

// ─── DELETE /api/heroes/:id/equipment/:equipId — remove an equipment item (GM only)
router.delete("/:id/equipment/:equipId", requireToken(["gm"]), async (req, res) => {
  try {
    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });

    if (hero.campaignId !== req.tokenPayload!.campaignId) {
      return res.status(403).json({ error: "Forbidden: hero is not in your campaign" });
    }

    (hero.equipment as any) = hero.equipment.filter((e: any) => e.id !== req.params.equipId);
    await hero.save();

    const io = req.app.get("io") as Server;
    io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });

    return res.json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to remove equipment" });
  }
});

// ─── POST /api/heroes/:id/consumables — add a consumable item (GM only) ───────
router.post("/:id/consumables", requireToken(["gm"]), async (req, res) => {
  try {
    const { name, quantity = 1, effect } = req.body as {
      name: string;
      quantity?: number;
      effect?: string;
    };
    if (!name) return res.status(400).json({ error: "name is required" });

    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });

    if (hero.campaignId !== req.tokenPayload!.campaignId) {
      return res.status(403).json({ error: "Forbidden: hero is not in your campaign" });
    }

    (hero.consumables as any).push({ id: nanoidEquip(), name, quantity, effect });
    await hero.save();

    const io = req.app.get("io") as Server;
    io.to(`campaign:${hero.campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(hero) });

    return res.status(201).json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to add consumable" });
  }
});

export default router;
