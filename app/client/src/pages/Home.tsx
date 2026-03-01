import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PackId } from "@hq/shared";

export default function Home() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"create" | "join">("create");

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
      // Store GM identity
      sessionStorage.setItem("role", "gm");
      sessionStorage.setItem("campaignId", data.campaign.id);
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
      const res = await fetch(`/api/campaigns/join/${code}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Campaign not found");
      sessionStorage.setItem("role", "player");
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
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="mb-8 text-center">
        <h1 className="text-5xl font-display text-hq-amber mb-2">⚔️ HeroQuest</h1>
        <p className="text-parchment/70 text-lg">Companion App</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 mb-6">
        <button
          className={`px-6 py-2 rounded-t font-semibold border-b-2 transition-colors ${
            tab === "create"
              ? "border-hq-amber text-hq-amber"
              : "border-transparent text-parchment/50 hover:text-parchment"
          }`}
          onClick={() => setTab("create")}
        >
          New Campaign
        </button>
        <button
          className={`px-6 py-2 rounded-t font-semibold border-b-2 transition-colors ${
            tab === "join"
              ? "border-hq-amber text-hq-amber"
              : "border-transparent text-parchment/50 hover:text-parchment"
          }`}
          onClick={() => setTab("join")}
        >
          Join Campaign
        </button>
      </div>

      <div className="card w-full max-w-md">
        {tab === "create" ? (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm text-parchment/70 mb-1">Campaign Name</label>
              <input
                className="input"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. The Witch Lord's Return"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-parchment/70 mb-2">Expansions</label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledPacks.includes("BASE")}
                    onChange={() => togglePack("BASE")}
                    className="accent-hq-amber w-4 h-4"
                  />
                  <span>Base Game</span>
                  <span className="text-xs text-parchment/50">Barbarian, Dwarf, Elf, Wizard</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledPacks.includes("DREAD_MOON")}
                    onChange={() => togglePack("DREAD_MOON")}
                    className="accent-hq-amber w-4 h-4"
                  />
                  <span>Rise of the Dread Moon</span>
                  <span className="text-xs text-parchment/50">+ Knight, reputation & more</span>
                </label>
              </div>
            </div>

            {createError && <p className="text-hq-red text-sm">{createError}</p>}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={creating || enabledPacks.length === 0}
            >
              {creating ? "Creating…" : "Create Campaign (GM)"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-sm text-parchment/70 mb-1">Join Code</label>
              <input
                className="input text-center text-2xl tracking-widest uppercase"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABCXYZ"
                maxLength={6}
                required
              />
            </div>

            {joinError && <p className="text-hq-red text-sm">{joinError}</p>}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={joining || joinCode.length < 6}
            >
              {joining ? "Joining…" : "Join as Player"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
