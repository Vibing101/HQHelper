import { Router } from "express";
import { SessionModel } from "../models/Session";
import { CampaignModel } from "../models/Campaign";
import { HeroModel } from "../models/Hero";
import { QUESTS, resolveEffectiveRules } from "@hq/shared";
import type { PackId } from "@hq/shared";
import { docToJson } from "../utils/docToJson";
import { requireToken, ownsCampaign } from "../middleware/requireToken";

const router = Router();

// POST /api/campaigns/:campaignId/sessions — start a new session (GM only)
router.post(
  "/campaigns/:campaignId/sessions",
  requireToken(["gm"]),
  ownsCampaign("campaignId"),
  async (req, res) => {
    try {
      const { questId } = req.body as { questId: string };
      if (!questId) return res.status(400).json({ error: "questId is required" });

      const campaign = await CampaignModel.findById(req.params.campaignId);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      const quest = QUESTS.find((q) => q.id === questId);
      if (!quest) return res.status(404).json({ error: "Quest not found" });

      const pack = campaign.enabledPacks.find((p) => p === quest.packId) as PackId | undefined;
      if (!pack) return res.status(400).json({ error: `Pack ${quest.packId} not enabled for this campaign` });

      const rulesSnapshot = resolveEffectiveRules(quest.packId, quest);

      const session = await SessionModel.create({
        campaignId: campaign._id.toString(),
        questId,
        startedAt: new Date(),
        rooms: [],
        monsters: [],
        rulesSnapshot,
      });

      // Persist the active session ID so the GM can resume after reload
      await CampaignModel.findByIdAndUpdate(req.params.campaignId, {
        currentSessionId: session._id.toString(),
      });

      return res.status(201).json({ session: docToJson(session) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to start session" });
    }
  }
);

// GET /api/sessions/:id — load session (read-only, no auth required)
router.get("/sessions/:id", async (req, res) => {
  try {
    const session = await SessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ error: "Not found" });
    return res.json({ session: docToJson(session) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load session" });
  }
});

// PATCH /api/sessions/:id/end — end the active session (GM only)
router.patch("/sessions/:id/end", requireToken(["gm"]), async (req, res) => {
  try {
    const session = await SessionModel.findByIdAndUpdate(
      req.params.id,
      { endedAt: new Date() },
      { new: true }
    );
    if (!session) return res.status(404).json({ error: "Not found" });

    // Verify the session belongs to the GM's campaign
    if (session.campaignId !== req.tokenPayload!.campaignId) {
      return res.status(403).json({ error: "Forbidden: session is not in your campaign" });
    }

    // Clear currentSessionId on the owning campaign
    await CampaignModel.findOneAndUpdate(
      { currentSessionId: req.params.id },
      { $unset: { currentSessionId: 1 } }
    );

    // Reset all heroes in the campaign: full HP/MP, clear per-quest state
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

    return res.json({ session: docToJson(session) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to end session" });
  }
});

export default router;
