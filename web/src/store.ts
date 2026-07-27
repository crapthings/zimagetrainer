import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Training = { status: string; stage?: string; step: number; total: number; loss?: number; samplePath?: string; samplePaths: string[]; lossHistory: {step:number;loss:number}[]; logs: string[] }
export type Captioning = { status: 'idle'|'started'|'progress'|'finished'|'error'; current: number; total: number; path?: string; error?: string }
type State = {
  folder: string; apiKey: string; model: string; images: {path:string;caption:string}[]; captioning: Captioning; training: Training
  set: (patch: Partial<State>) => void; addLog: (line:string) => void
}
export const useStore = create<State>()(persist((set) => ({
  folder: 'data/train', apiKey: '', model: 'gemini-3.1-flash-lite', images: [], captioning: {status:'idle',current:0,total:0},
  training: {status: 'idle', step: 0, total: 1000, samplePaths: [], lossHistory: [], logs: []},
  set: (patch) => set(patch), addLog: (line) => set((s) => ({training: {...s.training, logs: [...s.training.logs.slice(-99), line]}}))
}), {
  name: 'zimage-trainer-settings',
  partialize: (state) => ({ apiKey: state.apiKey, model: state.model }),
}))
