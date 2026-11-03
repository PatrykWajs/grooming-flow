import { create } from 'zustand'
import type { ProgressMessage } from '../ai/protocol'
import type { EngineData } from '../engine/recommend'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'success' | 'error'
}

interface AppState {
  engineData: EngineData | null
  setEngineData: (data: EngineData) => void
  toasts: Toast[]
  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
  modelProgress: Record<string, { loaded: number; total: number; status: ProgressMessage['status'] }>
  setModelProgress: (p: ProgressMessage) => void
  backend: 'webgpu' | 'wasm' | null
  setBackend: (b: 'webgpu' | 'wasm') => void
}

let toastSeq = 0

export const useAppStore = create<AppState>((set) => ({
  engineData: null,
  setEngineData: (engineData) => set({ engineData }),
  toasts: [],
  toast: (text, tone = 'info') => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  modelProgress: {},
  setModelProgress: (p) =>
    set((s) => ({ modelProgress: { ...s.modelProgress, [`${p.model}/${p.file}`]: { loaded: p.loaded, total: p.total, status: p.status } } })),
  backend: null,
  setBackend: (backend) => set({ backend }),
}))
