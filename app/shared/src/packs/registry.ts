import type { PackId, PackDefinition } from "../types";
import { resolveEffectiveRules } from "../types";
import { BASE_PACK } from "./base";
import { DREAD_MOON_PACK } from "./dreadMoon";

export const PACK_REGISTRY: Record<PackId, PackDefinition> = {
  BASE: BASE_PACK,
  DREAD_MOON: DREAD_MOON_PACK,
};

export { resolveEffectiveRules };
