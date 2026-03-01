interface Props {
  label: string;
  current: number;
  max: number;
  color?: "red" | "blue";
  onAdjust: (delta: number) => void;
}

export default function StatAdjuster({ label, current, max, color = "red", onAdjust }: Props) {
  const barColor = color === "red" ? "bg-hq-red" : "bg-blue-500";
  const pct = max > 0 ? (current / max) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-parchment/70">{label}</span>
        <span className="font-bold text-parchment">
          {current} / {max}
        </span>
      </div>
      <div className="h-3 bg-hq-dark rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-2 justify-center">
        <button
          className="btn-danger text-sm px-3 py-1"
          onClick={() => onAdjust(-1)}
          disabled={current <= 0}
        >
          −1
        </button>
        <button
          className="btn-secondary text-sm px-3 py-1"
          onClick={() => onAdjust(-2)}
          disabled={current <= 1}
        >
          −2
        </button>
        <button
          className="btn-secondary text-sm px-3 py-1"
          onClick={() => onAdjust(1)}
          disabled={current >= max}
        >
          +1
        </button>
        <button
          className="btn-secondary text-sm px-3 py-1"
          onClick={() => onAdjust(2)}
          disabled={current >= max}
        >
          +2
        </button>
      </div>
    </div>
  );
}
