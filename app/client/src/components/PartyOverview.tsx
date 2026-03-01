import type { Hero } from "@hq/shared";
import HeroCard from "./HeroCard";
import { sendCommand } from "../socket";

interface Props {
  heroes: Hero[];
  isGM: boolean;
}

export default function PartyOverview({ heroes, isGM }: Props) {
  function adjust(hero: Hero, pool: "BP" | "MP", delta: number) {
    sendCommand({
      type: "ADJUST_POINTS",
      entityType: "hero",
      entityId: hero.id,
      pool,
      delta,
    });
  }

  if (heroes.length === 0) {
    return <p className="text-parchment/40 text-sm text-center py-4">No heroes in party yet</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {heroes.map((hero) => (
        <HeroCard
          key={hero.id}
          hero={hero}
          onAdjustBP={isGM ? (d) => adjust(hero, "BP", d) : undefined}
          onAdjustMP={isGM ? (d) => adjust(hero, "MP", d) : undefined}
        />
      ))}
    </div>
  );
}
