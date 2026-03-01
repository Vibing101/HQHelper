import { QUESTS } from "@hq/shared";
import type { Campaign } from "@hq/shared";

interface Props {
  campaign: Campaign;
  onSelectQuest: (questId: string) => void;
  selectedQuestId?: string;
  isGM?: boolean;
  onUnlockQuest?: (questId: string) => void;
}

const PACK_LABELS: Record<string, string> = {
  BASE: "Base Game",
  DREAD_MOON: "Rise of the Dread Moon",
};

export default function QuestSelector({ campaign, onSelectQuest, selectedQuestId, isGM, onUnlockQuest }: Props) {
  const availableQuests = QUESTS.filter((q) => campaign.enabledPacks.includes(q.packId));

  const groupedByPack = availableQuests.reduce<Record<string, typeof QUESTS>>((acc, q) => {
    if (!acc[q.packId]) acc[q.packId] = [];
    acc[q.packId].push(q);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(groupedByPack).map(([packId, quests]) => (
        <div key={packId}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-hq-amber mb-2">
            {PACK_LABELS[packId] ?? packId}
          </h3>
          <div className="space-y-1">
            {quests.map((q) => {
              const logEntry = campaign.questLog.find((l) => l.questId === q.id);
              const status = logEntry?.status ?? "locked";
              const isSelected = q.id === selectedQuestId;

              return (
                <div key={q.id} className="flex items-center gap-1">
                  <button
                    onClick={() => status !== "locked" && onSelectQuest(q.id)}
                    disabled={status === "locked"}
                    className={`flex-1 text-left px-3 py-2 rounded flex items-center gap-2 transition-colors ${
                      isSelected
                        ? "bg-hq-amber text-hq-dark font-bold"
                        : status === "completed"
                        ? "bg-hq-green/20 text-parchment/70 hover:bg-hq-green/30"
                        : status === "available"
                        ? "bg-hq-brown text-parchment hover:bg-hq-brown/70"
                        : "bg-hq-dark/50 text-parchment/30 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-xs w-6 text-center">
                      {status === "completed" ? "✓" : status === "locked" ? "🔒" : `${q.number}`}
                    </span>
                    <span className="flex-1 truncate">{q.title}</span>
                    {status === "completed" && (
                      <span className="text-xs text-hq-green">Done</span>
                    )}
                  </button>
                  {isGM && status === "locked" && onUnlockQuest && (
                    <button
                      onClick={() => onUnlockQuest(q.id)}
                      className="text-xs px-2 py-1 rounded bg-hq-amber/20 text-hq-amber hover:bg-hq-amber/40 shrink-0"
                      title="Unlock this quest"
                    >
                      Unlock
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
