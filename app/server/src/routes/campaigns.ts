import { Router } from "express";
import { customAlphabet } from "nanoid";
import { CampaignModel } from "../models/Campaign";
import { HeroModel } from "../models/Hero";
import { PartyModel } from "../models/Party";
import { QUESTS } from "@hq/shared";
import type { PackId } from "@hq/shared";
import { docToJson } from "../utils/docToJson";
import type { Server } from "socket.io";
import { signToken } from "../auth";
import { requireToken, ownsCampaign } from "../middleware/requireToken";

const router = Router();
const nanoid6 = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 6);

// POST /api/campaigns — create a new campaign (GM)
// Returns a signed GM token so the creator can immediately authenticate.
router.post("/", async (req, res) => {
  try {
    const { name, enabledPacks } = req.body as { name: string; enabledPacks: PackId[] };

    if (!name || !enabledPacks?.length) {
      return res.status(400).json({ error: "name and enabledPacks are required" });
    }

    const party = await PartyModel.create({ campaignId: "pending", heroIds: [], reputationTokens: 0 });

    const questLog = QUESTS.filter((q) => enabledPacks.includes(q.packId)).map((q, i) => ({
      questId: q.id,
      status: i === 0 ? "available" : "locked",
    }));

    const joinCode = nanoid6();

    const campaign = await CampaignModel.create({
      name,
      joinCode,
      enabledPacks,
      partyId: party._id.toString(),
      questLog,
    });

    await PartyModel.findByIdAndUpdate(party._id, { campaignId: campaign._id.toString() });

    // Issue a GM token — campaignId is now known, no heroId for the GM
    const token = signToken({ campaignId: campaign._id.toString(), role: "gm" });

    return res.status(201).json({ campaign: docToJson(campaign), joinCode, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create campaign" });
  }
});

// GET /api/campaigns/join/:code — find campaign by join code and issue a player token
// Query param: playerId  (client-generated persistent player identifier)
// Must be before /:id to avoid route shadowing.
router.get("/join/:code", async (req, res) => {
  try {
    const campaign = await CampaignModel.findOne({ joinCode: req.params.code.toUpperCase() });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const playerId = (req.query.playerId as string | undefined)?.trim();
    if (!playerId) {
      return res.status(400).json({ error: "playerId query parameter is required" });
    }

    // Issue a player token without heroId — heroId is added after hero creation/claim
    const token = signToken({
      campaignId: campaign._id.toString(),
      role: "player",
      playerId,
    });

    return res.json({ campaign: docToJson(campaign), token });
  } catch (err) {
    return res.status(500).json({ error: "Failed to join" });
  }
});

// GET /api/campaigns/:id — load campaign (read-only, no auth required)
router.get("/:id", async (req, res) => {
  try {
    const campaign = await CampaignModel.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Not found" });
    return res.json({ campaign: docToJson(campaign) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load campaign" });
  }
});

// PATCH /api/campaigns/:id/quest-log/:questId — update quest status (GM only)
router.patch(
  "/:id/quest-log/:questId",
  requireToken(["gm"]),
  ownsCampaign("id"),
  async (req, res) => {
    try {
      const { status } = req.body as { status: string };
      const campaign = await CampaignModel.findById(req.params.id);
      if (!campaign) return res.status(404).json({ error: "Not found" });

      const entry = campaign.questLog.find((q) => q.questId === req.params.questId);
      if (!entry) return res.status(404).json({ error: "Quest not in log" });

      entry.status = status as "locked" | "available" | "completed";
      if (status === "completed") {
        entry.completedAt = new Date();
        // Auto-unlock the next quest in the log
        const idx = campaign.questLog.findIndex((q) => q.questId === req.params.questId);
        const next = campaign.questLog[idx + 1];
        if (next && next.status === "locked") next.status = "available";

        // Reset spell selections for all heroes — new quest means new spell picks
        const campaignId = req.params.id;
        await HeroModel.updateMany({ campaignId }, { $set: { spellsChosenThisQuest: [] } });
        const io = req.app.get("io") as Server;
        const heroes = await HeroModel.find({ campaignId });
        for (const h of heroes) {
          io.to(`campaign:${campaignId}`).emit("state_update", { type: "HERO_UPDATED", hero: docToJson(h) });
        }
      }
      await campaign.save();

      return res.json({ campaign: docToJson(campaign) });
    } catch (err) {
      return res.status(500).json({ error: "Failed to update quest" });
    }
  }
);

export default router;
