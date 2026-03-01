import mongoose, { Schema, Document } from "mongoose";
import type { Session } from "@hq/shared";

export interface SessionDoc extends Omit<Session, "id">, Document {}

const RoomStateSchema = new Schema(
  {
    roomId: String,
    state: { type: String, enum: ["hidden", "revealed", "cleared"], default: "hidden" },
  },
  { _id: false }
);

const MonsterInstanceSchema = new Schema(
  {
    id: String,
    monsterTypeId: String,
    label: String,
    bodyPointsCurrent: Number,
    bodyPointsMax: Number,
    mindPointsCurrent: Number,
    roomId: String,
    statusFlags: {
      isEthereal: Boolean,
      isSmokeBombed: Boolean,
    },
  },
  { _id: false }
);

const SessionSchema = new Schema<SessionDoc>(
  {
    campaignId: { type: String, required: true },
    questId: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
    rooms: [RoomStateSchema],
    monsters: [MonsterInstanceSchema],
    rulesSnapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: false }
);

export const SessionModel = mongoose.model<SessionDoc>("Session", SessionSchema);
