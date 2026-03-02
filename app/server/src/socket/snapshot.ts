import type { Socket } from "socket.io";
import type { StateSnapshot } from "@hq/shared";
import { CampaignModel } from "../models/Campaign";
import { PartyModel } from "../models/Party";
import { HeroModel } from "../models/Hero";
import { SessionModel } from "../models/Session";
import { docToJson } from "../utils/docToJson";
import { ensureHeroStateShape } from "../utils/heroState";

export async function buildSnapshotForSocket(socket: Socket, preferredSessionId?: string): Promise<StateSnapshot> {
  const campaignId = socket.data.campaignId as string;
  const campaign = await CampaignModel.findById(campaignId);

  let party = null;
  if (campaign?.partyId) {
    party = await PartyModel.findById(campaign.partyId);
    if (party) {
      const p = party as any;
      if (!Array.isArray(p.unlockedMercenaryTypes)) p.unlockedMercenaryTypes = [];
      if (!Array.isArray(p.mercenaries)) p.mercenaries = [];
      if (typeof p.reputationTokens !== "number") p.reputationTokens = 0;
    }
  }

  const heroesDocs = await HeroModel.find({ campaignId });
  for (const hero of heroesDocs) {
    if (ensureHeroStateShape(hero)) await hero.save();
  }

  const sessionId = preferredSessionId ?? (socket.data.sessionId as string | undefined) ?? campaign?.currentSessionId;
  const session = sessionId ? await SessionModel.findById(sessionId) : null;

  return {
    campaign: campaign ? docToJson(campaign) : null,
    party: party ? docToJson(party) : null,
    heroes: heroesDocs.map(docToJson),
    session: session ? docToJson(session) : null,
    requestedAt: new Date().toISOString(),
  };
}
