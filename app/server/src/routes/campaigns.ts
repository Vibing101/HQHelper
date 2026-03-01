import { Router } from "express";
import { customAlphabet } from "nanoid";
import { CampaignModel } from "../models/Campaign";
import { PartyModel } from "../models/Party";
import { QUESTS } from "@hq/shared";
import type { PackId } from "@hq/shared";
import { docToJson } from "../utils/docToJson";

const router = Router();
const nanoid6 = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 6);

// POST /api/campaigns — create a new campaign
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

    return res.status(201).json({ campaign: docToJson(campaign), joinCode });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create campaign" });
  }
});

// GET /api/campaigns/join/:code — find campaign by join code (must be before /:id)
router.get("/join/:code", async (req, res) => {
  try {
    const campaign = await CampaignModel.findOne({ joinCode: req.params.code.toUpperCase() });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    return res.json({ campaign: docToJson(campaign) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to join" });
  }
});

// GET /api/campaigns/:id — load campaign
router.get("/:id", async (req, res) => {
  try {
    const campaign = await CampaignModel.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Not found" });
    return res.json({ campaign: docToJson(campaign) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load campaign" });
  }
});

// PATCH /api/campaigns/:id/quest-log/:questId — update quest status
router.patch("/:id/quest-log/:questId", async (req, res) => {
  try {
    const { status } = req.body as { status: string };
    const campaign = await CampaignModel.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Not found" });

    const entry = campaign.questLog.find((q) => q.questId === req.params.questId);
    if (!entry) return res.status(404).json({ error: "Quest not in log" });

    entry.status = status as "locked" | "available" | "completed";
    if (status === "completed") entry.completedAt = new Date();
    await campaign.save();

    return res.json({ campaign: docToJson(campaign) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update quest" });
  }
});

export default router;
