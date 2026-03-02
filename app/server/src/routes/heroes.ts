import { Router } from "express";
import type { Server } from "socket.io";
import { HeroModel } from "../models/Hero";
import { PartyModel } from "../models/Party";
import { HERO_BASE_STATS } from "@hq/shared";
import type { HeroTypeId } from "@hq/shared";
import { docToJson } from "../utils/docToJson";
import { signToken } from "../auth";
import { requireToken } from "../middleware/requireToken";
import { ensureHeroStateShape } from "../utils/heroState";

const router = Router();

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
      equipped: {},
      inventory: [],
      consumables: [],
      artifacts: [],
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
    if (ensureHeroStateShape(hero)) await hero.save();

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
    for (const hero of heroes) {
      if (ensureHeroStateShape(hero)) await hero.save();
    }
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
    if (ensureHeroStateShape(hero)) await hero.save();
    return res.json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load hero" });
  }
});

export default router;
