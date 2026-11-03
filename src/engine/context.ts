import type { EngineItem, Occasion, RecommendContext, RecommendSettings, UserSignals } from './types'

export const DEFAULT_SETTINGS: RecommendSettings = {
  runsHotCold: 0,
  sneakersAtWork: true,
  allowSuedeInRain: false,
  cooldownDays: { base: 1, layer: 1, bottoms: 1, shoes: 1, outer: 1, belt: 0, accessory: 0, set: 1 },
  cooldownScore: { base: 0, layer: 0, bottoms: 0, shoes: 0.5, outer: 0.5, belt: 0.5, accessory: 0.5, set: 0 },
  noRepeatDays: 30,
  seed: '',
}

export function emptySignals(): UserSignals {
  return { liked: new Set(), disliked: new Set(), neverTogether: new Set(), locked: new Set(), excluded: new Set() }
}

export function makeContext(
  date: string,
  items: EngineItem[],
  weather: RecommendContext['weather'],
  occasion: Occasion,
  overrides: Partial<Omit<RecommendContext, 'date' | 'items' | 'weather' | 'occasion'>> = {},
): RecommendContext {
  return {
    date,
    items,
    weather,
    occasion,
    signals: overrides.signals ?? emptySignals(),
    settings: { ...DEFAULT_SETTINGS, seed: date, ...(overrides.settings ?? {}) },
    recentOutfits: overrides.recentOutfits ?? [],
    wornRecently: overrides.wornRecently ?? new Map(),
  }
}
