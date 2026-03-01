import mongoose, { Schema, Document } from "mongoose";
import type { Hero } from "@hq/shared";

export interface HeroDoc extends Omit<Hero, "id">, Document {}

const EquipmentSchema = new Schema(
  { id: String, name: String, attackBonus: Number, defendBonus: Number },
  { _id: false }
);

const ItemSchema = new Schema(
  { id: String, name: String, quantity: Number, effect: String },
  { _id: false }
);

const HeroSchema = new Schema<HeroDoc>({
  heroTypeId: { type: String, required: true },
  name: { type: String, required: true },
  playerId: { type: String, required: true },
  campaignId: { type: String, required: true },

  bodyPointsMax: { type: Number, required: true },
  bodyPointsCurrent: { type: Number, required: true },
  mindPointsMax: { type: Number, required: true },
  mindPointsCurrent: { type: Number, required: true },

  attackDice: { type: Number, required: true },
  defendDice: { type: Number, required: true },

  gold: { type: Number, default: 0 },
  equipment: [EquipmentSchema],
  consumables: [ItemSchema],
  spellsChosenThisQuest: [String],

  statusFlags: {
    isDead: { type: Boolean, default: false },
    isInShock: { type: Boolean, default: false },
    isDisguised: { type: Boolean, default: false },
  },
});

export const HeroModel = mongoose.model<HeroDoc>("Hero", HeroSchema);
