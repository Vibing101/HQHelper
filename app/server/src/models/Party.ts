import mongoose, { Schema, Document } from "mongoose";
import type { Party } from "@hq/shared";

export interface PartyDoc extends Omit<Party, "id">, Document {}

const PartySchema = new Schema<PartyDoc>({
  campaignId: { type: String, required: true },
  heroIds: [String],
  reputationTokens: { type: Number, default: 0 },
});

export const PartyModel = mongoose.model<PartyDoc>("Party", PartySchema);
