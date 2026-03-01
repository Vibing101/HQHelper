import { useEffect, useState } from "react";

const WAKE_URL = import.meta.env.VITE_WAKE_URL as string | undefined;

type Status = "checking" | "stopped" | "starting" | "running";

export default function ServerGate({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<Status>("checking");

  const check = async () => {
    try {
      const res = await fetch(WAKE_URL!);
      const { status: s } = (await res.json()) as { status: string };
      if (s === "running") {
        setStatus("running");
        setTimeout(onReady, 3000); // give nginx a moment to be ready
      } else {
        setStatus(s === "pending" ? "starting" : "stopped");
      }
    } catch {
      setStatus("stopped");
    }
  };

  useEffect(() => {
    if (!WAKE_URL) {
      onReady(); // local dev: no wake URL, skip the gate
      return;
    }
    check();
  }, []);

  useEffect(() => {
    if (status !== "starting") return;
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [status]);

  const wake = async () => {
    setStatus("starting");
    await fetch(WAKE_URL!, { method: "POST" });
  };

  if (status === "running") return null;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-stone-950 text-amber-100">
      <h1 className="text-3xl font-bold tracking-wide">HeroQuest Companion</h1>
      {status === "checking" && (
        <p className="text-stone-400">Checking server…</p>
      )}
      {status === "stopped" && (
        <>
          <p className="text-stone-400">The server is offline.</p>
          <button
            onClick={wake}
            className="px-6 py-3 bg-amber-600 hover:bg-amber-500 rounded-lg font-semibold transition-colors"
          >
            Wake Server
          </button>
        </>
      )}
      {status === "starting" && (
        <p className="text-stone-400 animate-pulse">
          Server waking up… (~30 s)
        </p>
      )}
    </div>
  );
}
