import mongoose, { Schema, Document } from "mongoose";
import type { Hero } from "@hq/shared";

export interface HeroDoc extends Omit<Hero, "id">, Document {}

const EquippedItemSchema = new Schema(
  { instanceId: String, itemId: String },
  { _id: false }
);

const InventoryItemSchema = new Schema(
  { instanceId: String, itemId: String },
  { _id: false }
);

const ConsumableItemSchema = new Schema(
  {
    instanceId: String,
    itemId: String,
    quantity: Number,
    usesRemaining: Number,
    name: String,
    effect: String,
  },
  { _id: false }
);

const ArtifactInstanceSchema = new Schema(
  { instanceId: String, artifactId: String },
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
  equipped: {
    weaponMain: { type: EquippedItemSchema },
    weaponOff:  { type: EquippedItemSchema },
    armorBody:  { type: EquippedItemSchema },
    armorHead:  { type: EquippedItemSchema },
  },
  inventory: { type: [InventoryItemSchema], default: [] },
  consumables: { type: [ConsumableItemSchema], default: [] },
  artifacts: { type: [ArtifactInstanceSchema], default: [] },
  spellsChosenThisQuest: [String],

  statusFlags: {
    isDead: { type: Boolean, default: false },
    isInShock: { type: Boolean, default: false },
    isDisguised: { type: Boolean, default: false },
  },
});

export const HeroModel = mongoose.model<HeroDoc>("Hero", HeroSchema);
