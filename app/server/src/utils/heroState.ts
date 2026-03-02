import { customAlphabet } from "nanoid";
import { ITEM_CATALOG } from "@hq/shared";
import type { HeroDoc } from "../models/Hero";

const nanoidState = customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 8);

export function ensureHeroStateShape(hero: HeroDoc): boolean {
  const h = hero as any;
  let changed = false;

  if (!h.equipped || typeof h.equipped !== "object") {
    const legacyEquipment = h.equipment && typeof h.equipment === "object" ? h.equipment : {};
    h.equipped = legacyEquipment;
    changed = true;
  }

  if (!Array.isArray(h.inventory)) {
    h.inventory = [];
    changed = true;
  }

  if (!Array.isArray(h.artifacts)) {
    h.artifacts = [];
    changed = true;
  }

  if (!Array.isArray(h.consumables)) {
    h.consumables = [];
    changed = true;
  }

  h.consumables = h.consumables.map((entry: any) => {
    const quantity = typeof entry.quantity === "number" && entry.quantity > 0 ? entry.quantity : 1;
    const instanceId = typeof entry.instanceId === "string" && entry.instanceId ? entry.instanceId :
      (typeof entry.id === "string" && entry.id ? entry.id : nanoidState());

    const existingItemId = typeof entry.itemId === "string" && entry.itemId ? entry.itemId : undefined;
    const catalogMatch = !existingItemId && entry.name
      ? ITEM_CATALOG.find((i) => i.category === "consumable" && i.name === entry.name)
      : undefined;

    const normalized = {
      instanceId,
      itemId: existingItemId ?? catalogMatch?.id ?? "custom_consumable",
      quantity,
      usesRemaining: typeof entry.usesRemaining === "number" ? entry.usesRemaining : undefined,
      name: typeof entry.name === "string" ? entry.name : undefined,
      effect: typeof entry.effect === "string" ? entry.effect : undefined,
    };

    if (
      entry.instanceId !== normalized.instanceId ||
      entry.itemId !== normalized.itemId ||
      entry.quantity !== normalized.quantity ||
      entry.usesRemaining !== normalized.usesRemaining ||
      entry.name !== normalized.name ||
      entry.effect !== normalized.effect
    ) {
      changed = true;
    }

    return normalized;
  });

  if (changed) {
    hero.markModified("equipped");
    hero.markModified("inventory");
    hero.markModified("consumables");
    hero.markModified("artifacts");
  }

  return changed;
}
