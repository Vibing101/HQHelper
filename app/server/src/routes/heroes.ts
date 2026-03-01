import { Router } from "express";
import { customAlphabet } from "nanoid";
import { HeroModel } from "../models/Hero";
import { PartyModel } from "../models/Party";
import { HERO_BASE_STATS } from "@hq/shared";
import type { HeroTypeId } from "@hq/shared";
import { docToJson } from "../utils/docToJson";

const router = Router();
const nanoidEquip = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 8);

// POST /api/heroes — create a hero
router.post("/", async (req, res) => {
  try {
    const { heroTypeId, name, playerId, campaignId, partyId } = req.body as {
      heroTypeId: HeroTypeId;
      name: string;
      playerId: string;
      campaignId: string;
      partyId: string;
    };

    if (!heroTypeId || !name || !playerId || !campaignId) {
      return res.status(400).json({ error: "heroTypeId, name, playerId, campaignId are required" });
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
      playerId,
      campaignId,
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

    return res.status(201).json({ hero: docToJson(hero) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create hero" });
  }
});

// GET /api/heroes/campaign/:campaignId — list heroes for a campaign (before /:id)
router.get("/campaign/:campaignId", async (req, res) => {
  try {
    const heroes = await HeroModel.find({ campaignId: req.params.campaignId });
    return res.json({ heroes: heroes.map(docToJson) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to list heroes" });
  }
});

// GET /api/heroes/:id — load hero
router.get("/:id", async (req, res) => {
  try {
    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });
    return res.json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load hero" });
  }
});

// PATCH /api/heroes/:id/gold — award or deduct gold
router.patch("/:id/gold", async (req, res) => {
  try {
    const { amount } = req.body as { amount: number };
    if (typeof amount !== "number") return res.status(400).json({ error: "amount must be a number" });

    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });

    hero.gold = Math.max(0, hero.gold + amount);
    await hero.save();
    return res.json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update gold" });
  }
});

// POST /api/heroes/:id/equipment — add an equipment item
router.post("/:id/equipment", async (req, res) => {
  try {
    const { name, attackBonus, defendBonus } = req.body as {
      name: string;
      attackBonus?: number;
      defendBonus?: number;
    };
    if (!name) return res.status(400).json({ error: "name is required" });

    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });

    (hero.equipment as any).push({ id: nanoidEquip(), name, attackBonus, defendBonus });
    await hero.save();
    return res.status(201).json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to add equipment" });
  }
});

// DELETE /api/heroes/:id/equipment/:equipId — remove an equipment item
router.delete("/:id/equipment/:equipId", async (req, res) => {
  try {
    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });

    (hero.equipment as any) = hero.equipment.filter((e: any) => e.id !== req.params.equipId);
    await hero.save();
    return res.json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to remove equipment" });
  }
});

// POST /api/heroes/:id/consumables — add a consumable item
router.post("/:id/consumables", async (req, res) => {
  try {
    const { name, quantity = 1, effect } = req.body as {
      name: string;
      quantity?: number;
      effect?: string;
    };
    if (!name) return res.status(400).json({ error: "name is required" });

    const hero = await HeroModel.findById(req.params.id);
    if (!hero) return res.status(404).json({ error: "Not found" });

    (hero.consumables as any).push({ id: nanoidEquip(), name, quantity, effect });
    await hero.save();
    return res.status(201).json({ hero: docToJson(hero) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to add consumable" });
  }
});

export default router;
