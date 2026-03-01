import mongoose, { Schema, Document } from "mongoose";
import type { Campaign, PackId } from "@hq/shared";

export interface CampaignDoc extends Omit<Campaign, "id">, Document {}

const QuestLogSchema = new Schema(
  {
    questId: { type: String, required: true },
    status: { type: String, enum: ["locked", "available", "completed"], default: "locked" },
    completedAt: Date,
  },
  { _id: false }
);

const CampaignSchema = new Schema<CampaignDoc>(
  {
    name: { type: String, required: true },
    joinCode: { type: String, required: true, unique: true },
    enabledPacks: [{ type: String }],
    partyId: { type: String, required: true },
    currentSessionId: { type: String },
    questLog: [QuestLogSchema],
  },
  { timestamps: { createdAt: "createdAt" } }
);

export const CampaignModel = mongoose.model<CampaignDoc>("Campaign", CampaignSchema);
