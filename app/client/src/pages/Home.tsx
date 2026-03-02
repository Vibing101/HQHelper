import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PackId } from "@hq/shared";
import { useAuthStore } from "../store/authStore";

const LS_GM_ID   = "gmCampaignId";
const LS_GM_NAME = "gmCampaignName";

const PACK_OPTIONS: { id: PackId; label: string; subtitle: string; heroes: string }[] = [
  {
    id: "BASE",
    label: "Base Game",
    subtitle: "The original adventure",
    heroes: "Barbarian · Dwarf · Elf · Wizard",
  },
  {
    id: "DREAD_MOON",
    label: "Rise of the Dread Moon",
    subtitle: "Expansion pack",
    heroes: "+ Knight · reputation · more",
  },
];

export default function Home() {
  const navigate = useNavigate();
  const { setToken } = useAuthStore();

  const [tab, setTab] = useState<"create" | "join">("create");
  const [savedCampaignId]   = useState(() => localStorage.getItem(LS_GM_ID));
  const [savedCampaignName] = useState(() => localStorage.getItem(LS_GM_NAME));

  // Create campaign state
  const [campaignName, setCampaignName] = useState("");
  const [enabledPacks, setEnabledPacks] = useState<PackId[]>(["BASE"]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Join state
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    if (!campaignName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: campaignName, enabledPacks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create");

      // Store the GM token issued by the server (persists to localStorage)
      setToken(data.token);

      sessionStorage.setItem("campaignId", data.campaign.id);
      localStorage.setItem(LS_GM_ID, data.campaign.id);
      localStorage.setItem(LS_GM_NAME, data.campaign.name);
      navigate(`/gm/${data.campaign.id}`);
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setJoinError("");
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    try {
      // Reuse or generate a persistent player ID for this browser / tab
      let pid = sessionStorage.getItem("playerId");
      if (!pid) {
        pid = `player-${Math.random().toString(36).slice(2, 9)}`;
        sessionStorage.setItem("playerId", pid);
      }

      const res = await fetch(`/api/campaigns/join/${code}?playerId=${encodeURIComponent(pid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Campaign not found");

      // Store the player token issued by the server
      setToken(data.token);

      sessionStorage.setItem("campaignId", data.campaign.id);
      navigate(`/play/${code}`);
    } catch (err: any) {
      setJoinError(err.message);
    } finally {
      setJoining(false);
    }
  }

  function togglePack(pack: PackId) {
    setEnabledPacks((prev) =>
      prev.includes(pack) ? prev.filter((p) => p !== pack) : [...prev, pack]
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-hq-dark">

      {/* Hero section */}
      <div className="mb-10 text-center">
        <div className="text-6xl mb-4">⚔️</div>
        <h1 className="text-5xl font-display text-hq-amber tracking-wide mb-2">HeroQuest</h1>
        <p className="text-parchment/50 text-base tracking-widest uppercase text-sm">Companion App</p>
        <div className="mt-4 h-px w-24 mx-auto bg-hq-amber/30" />
      </div>

      {/* GM resume banner */}
      {savedCampaignId && (
        <div className="w-full max-w-md mb-6 rounded-lg border border-hq-amber/40 bg-hq-brown/60 px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-parchment/40 uppercase tracking-widest mb-0.5">Previous Campaign</p>
            <p className="font-bold text-parchment truncate">{savedCampaignName ?? savedCampaignId}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              className="btn-primary text-sm px-4 py-1.5"
              onClick={() => {
                sessionStorage.setItem("campaignId", savedCampaignId);
                navigate(`/gm/${savedCampaignId}`);
              }}
            >
              Return
            </button>
            <button
              className="text-xs px-2 py-1.5 rounded border border-parchment/20 text-parchment/40 hover:text-hq-red hover:border-hq-red/40 transition-colors"
              title="Forget this campaign"
              onClick={() => {
                localStorage.removeItem(LS_GM_ID);
                localStorage.removeItem(LS_GM_NAME);
                window.location.reload();
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div className="w-full max-w-md mb-0">
        <div className="flex rounded-t-lg overflow-hidden border border-b-0 border-hq-amber/20">
          {(["create", "join"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-semibold tracking-wide transition-colors ${
                tab === t
                  ? "bg-hq-brown text-hq-amber"
                  : "bg-hq-dark/80 text-parchment/40 hover:text-parchment/70"
              }`}
            >
              {t === "create" ? "New Campaign" : "Join Campaign"}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="bg-hq-brown border border-hq-amber/20 rounded-b-lg rounded-tr-lg p-6">
          {tab === "create" ? (
            <form onSubmit={handleCreate} className="space-y-5">
              <div>
                <label className="block text-xs text-parchment/50 uppercase tracking-widest mb-2">
                  Campaign Name
                </label>
                <input
                  className="input"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g. The Witch Lord's Return"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-parchment/50 uppercase tracking-widest mb-3">
                  Expansions
                </label>
                <div className="space-y-2">
                  {PACK_OPTIONS.map((pack) => {
                    const checked = enabledPacks.includes(pack.id);
                    return (
                      <label
                        key={pack.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? "border-hq-amber/40 bg-hq-dark/40"
                            : "border-parchment/10 hover:border-parchment/20"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePack(pack.id)}
                          className="accent-hq-amber w-4 h-4 mt-0.5 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold ${checked ? "text-parchment" : "text-parchment/60"}`}>
                            {pack.label}
                          </p>
                          <p className="text-xs text-parchment/40">{pack.heroes}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {createError && (
                <p className="text-hq-red text-sm bg-hq-red/10 border border-hq-red/20 rounded px-3 py-2">
                  {createError}
                </p>
              )}

              <button
                type="submit"
                className="btn-primary w-full py-3"
                disabled={creating || enabledPacks.length === 0}
              >
                {creating ? "Creating…" : "Create Campaign (GM)"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-5">
              <div>
                <label className="block text-xs text-parchment/50 uppercase tracking-widest mb-2">
                  Join Code
                </label>
                <input
                  className="input text-center text-3xl tracking-[0.4em] uppercase font-display"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                  placeholder="ABCXYZ"
                  maxLength={6}
                  required
                />
                <p className="text-xs text-parchment/30 text-center mt-2">
                  Ask your Game Master for the 6-letter code
                </p>
              </div>

              {joinError && (
                <p className="text-hq-red text-sm bg-hq-red/10 border border-hq-red/20 rounded px-3 py-2">
                  {joinError}
                </p>
              )}

              <button
                type="submit"
                className="btn-primary w-full py-3"
                disabled={joining || joinCode.length < 6}
              >
                {joining ? "Joining…" : "Join as Player"}
              </button>
            </form>
          )}
        </div>
      </div>

    </div>
  );
}
