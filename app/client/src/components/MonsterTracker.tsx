import type { MonsterInstance } from "@hq/shared";
import { sendCommand } from "../socket";

interface Props {
  monsters: MonsterInstance[];
  sessionId: string;
  isGM: boolean;
}

export default function MonsterTracker({ monsters, sessionId, isGM }: Props) {
  function adjustBP(monster: MonsterInstance, delta: number) {
    sendCommand({
      type: "ADJUST_POINTS",
      entityType: "monster",
      entityId: monster.id,
      pool: "BP",
      delta,
    });
  }

  function removeMonster(monsterId: string) {
    sendCommand({ type: "REMOVE_MONSTER", sessionId, monsterId });
  }

  if (monsters.length === 0) {
    return <p className="text-parchment/40 text-sm text-center py-4">No monsters spawned</p>;
  }

  return (
    <div className="space-y-3">
      {monsters.map((m) => {
        const pct = m.bodyPointsMax > 0 ? (m.bodyPointsCurrent / m.bodyPointsMax) * 100 : 0;
        const isDead = m.bodyPointsCurrent <= 0;
        return (
          <div key={m.id} className={`card flex items-center gap-3 ${isDead ? "opacity-40" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-parchment truncate">{m.label}</span>
                {isDead && <span className="badge bg-gray-700 text-gray-300">Dead</span>}
              </div>
              <p className="text-xs text-parchment/50 capitalize">{m.monsterTypeId.replace(/_/g, " ")}</p>
              <div className="mt-1">
                <div className="h-2 bg-hq-dark rounded-full overflow-hidden">
                  <div className="h-full bg-hq-red transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-right text-parchment/60 mt-0.5">
                  {m.bodyPointsCurrent}/{m.bodyPointsMax} BP
                </p>
              </div>
            </div>

            {isGM && (
              <div className="flex flex-col gap-1 items-end">
                <div className="flex gap-1">
                  <button
                    className="text-xs px-2 py-0.5 bg-hq-red/60 rounded hover:bg-hq-red"
                    onClick={() => adjustBP(m, -1)}
                    disabled={isDead}
                  >
                    −1 BP
                  </button>
                  <button
                    className="text-xs px-2 py-0.5 bg-hq-green/60 rounded hover:bg-hq-green"
                    onClick={() => adjustBP(m, 1)}
                  >
                    +1 BP
                  </button>
                </div>
                {isDead && (
                  <button
                    className="text-xs px-2 py-0.5 bg-gray-700 rounded hover:bg-gray-600"
                    onClick={() => removeMonster(m.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
