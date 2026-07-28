import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Language } from "./i18n";

export type Training = {
  status: string;
  stage?: string;
  step: number;
  total: number;
  loss?: number;
  samplePath?: string;
  samplePaths: string[];
  lossHistory: { step: number; loss: number }[];
  logs: string[];
};
export type Captioning = {
  status: "idle" | "started" | "progress" | "finished" | "error";
  current: number;
  total: number;
  path?: string;
  error?: string;
};
export type GlobalError = {
  id: number;
  title: string;
  message: string;
  action?: { label: string; path: string };
};
type State = {
  folder: string;
  apiKey: string;
  model: string;
  language: Language;
  images: { path: string; caption: string }[];
  captioning: Captioning;
  training: Training;
  globalError: GlobalError | null;
  set: (patch: Partial<State>) => void;
  addLog: (line: string) => void;
  showError: (error: Omit<GlobalError, "id">) => void;
  clearError: () => void;
};
export const useStore = create<State>()(
  persist(
    (set) => ({
      folder: "data/train",
      apiKey: "",
      model: "gemini-3.5-flash-lite",
      language: "en",
      images: [],
      captioning: { status: "idle", current: 0, total: 0 },
      training: {
        status: "idle",
        step: 0,
        total: 1000,
        samplePaths: [],
        lossHistory: [],
        logs: [],
      },
      globalError: null,
      set: (patch) => set(patch),
      addLog: (line) =>
        set((s) => ({
          training: {
            ...s.training,
            logs: [...s.training.logs.slice(-99), line],
          },
        })),
      showError: (error) => set({ globalError: { ...error, id: Date.now() } }),
      clearError: () => set({ globalError: null }),
    }),
    {
      name: "zimage-trainer-settings",
      partialize: (state) => ({ apiKey: state.apiKey, model: state.model, language: state.language }),
    },
  ),
);
