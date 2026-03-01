import { create } from "zustand";
import type { Campaign } from "@hq/shared";

interface CampaignState {
  campaign: Campaign | null;
  loading: boolean;
  error: string | null;
  setCampaign: (c: Campaign) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  updateQuestStatus: (questId: string, status: "locked" | "available" | "completed") => void;
}

export const useCampaignStore = create<CampaignState>((set) => ({
  campaign: null,
  loading: false,
  error: null,
  setCampaign: (campaign) => set({ campaign }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  updateQuestStatus: (questId, status) =>
    set((state) => {
      if (!state.campaign) return state;
      const questLog = state.campaign.questLog.map((q) =>
        q.questId === questId
          ? { ...q, status, completedAt: status === "completed" ? new Date() : q.completedAt }
          : q
      );
      return { campaign: { ...state.campaign, questLog } };
    }),
}));
