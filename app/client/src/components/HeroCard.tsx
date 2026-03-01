import type { Hero } from "@hq/shared";

const HERO_ICONS: Record<string, string> = {
  barbarian: "⚔️",
  dwarf: "🪓",
  elf: "🏹",
  wizard: "🧙",
  knight: "🛡️",
};

interface Props {
  hero: Hero;
  onAdjustBP?: (delta: number) => void;
  onAdjustMP?: (delta: number) => void;
  compact?: boolean;
}

export default function HeroCard({ hero, onAdjustBP, onAdjustMP, compact = false }: Props) {
  const icon = HERO_ICONS[hero.heroTypeId] ?? "🧝";
  const bpPct = (hero.bodyPointsCurrent / hero.bodyPointsMax) * 100;
  const mpPct = (hero.mindPointsCurrent / hero.mindPointsMax) * 100;

  return (
    <div className={`card relative ${hero.statusFlags.isDead ? "opacity-50 grayscale" : ""}`}>
      {hero.statusFlags.isDead && (
        <div className="absolute inset-0 flex items-center justify-center text-4xl">💀</div>
      )}
      {hero.statusFlags.isInShock && !hero.statusFlags.isDead && (
        <span className="absolute top-2 right-2 badge bg-purple-700 text-white">SHOCKED</span>
      )}
      {hero.statusFlags.isDisguised && (
        <span className="absolute top-2 left-2 badge bg-gray-600 text-white">DISGUISED</span>
      )}

      <div className="flex items-center gap-3 mb-3">
        <span className="text-3xl">{icon}</span>
        <div>
          <p className="font-bold text-hq-amber">{hero.name}</p>
          <p className="text-xs text-parchment/60 capitalize">{hero.heroTypeId}</p>
        </div>
        <div className="ml-auto text-right text-xs text-parchment/60">
          <p>ATK {hero.attackDice}🎲</p>
          <p>DEF {hero.defendDice}🎲</p>
          <p>💰 {hero.gold}</p>
        </div>
      </div>

      {/* Body Points */}
      <div className="space-y-1 mb-2">
        <div className="flex justify-between text-xs">
          <span className="text-hq-red">Body Points</span>
          <span>{hero.bodyPointsCurrent}/{hero.bodyPointsMax}</span>
        </div>
        <div className="h-2 bg-hq-dark rounded-full overflow-hidden">
          <div className="h-full bg-hq-red transition-all" style={{ width: `${bpPct}%` }} />
        </div>
        {!compact && onAdjustBP && (
          <div className="flex gap-1">
            {[-2, -1, 1, 2].map((d) => (
              <button
                key={d}
                className={`flex-1 text-xs py-0.5 rounded ${d < 0 ? "bg-hq-red/60 hover:bg-hq-red" : "bg-hq-green/60 hover:bg-hq-green"}`}
                onClick={() => onAdjustBP(d)}
              >
                {d > 0 ? "+" : ""}{d}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mind Points */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-blue-400">Mind Points</span>
          <span>{hero.mindPointsCurrent}/{hero.mindPointsMax}</span>
        </div>
        <div className="h-2 bg-hq-dark rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${mpPct}%` }} />
        </div>
        {!compact && onAdjustMP && (
          <div className="flex gap-1">
            {[-2, -1, 1, 2].map((d) => (
              <button
                key={d}
                className={`flex-1 text-xs py-0.5 rounded ${d < 0 ? "bg-blue-900 hover:bg-blue-800" : "bg-blue-700 hover:bg-blue-600"}`}
                onClick={() => onAdjustMP(d)}
              >
                {d > 0 ? "+" : ""}{d}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
