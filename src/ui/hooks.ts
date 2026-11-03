import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, DEFAULT_SETTINGS, type ItemRecord, type SettingsRecord } from '../data/db'
import { loadEngineData } from '../engine/data'
import type { EngineData } from '../engine/recommend'
import { useAppStore } from './store'

/** Read-only (a live query must not write): defaults are merged in memory. */
export function useSettings(): SettingsRecord | undefined {
  return useLiveQuery(async () => {
    const stored = await db.settings.get('settings')
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) } as SettingsRecord
  }, [])
}

export function useItems(): ItemRecord[] | undefined {
  return useLiveQuery(() => db.items.toArray(), [])
}

export function useEngineData(): EngineData | null {
  const data = useAppStore((s) => s.engineData)
  const set = useAppStore((s) => s.setEngineData)
  useEffect(() => {
    if (!data) void loadEngineData().then(set)
  }, [data, set])
  return data
}

const urlCache = new Map<string, string>()

/** Object URL for a stored blob (cached for the session). */
export function useBlobUrl(blobId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(blobId ? (urlCache.get(blobId) ?? null) : null)
  useEffect(() => {
    let cancelled = false
    if (!blobId) {
      setUrl(null)
      return
    }
    const cached = urlCache.get(blobId)
    if (cached) {
      setUrl(cached)
      return
    }
    void db.blobs.get(blobId).then((record) => {
      if (cancelled || !record) return
      const created = URL.createObjectURL(record.bytes)
      urlCache.set(blobId, created)
      setUrl(created)
    })
    return () => {
      cancelled = true
    }
  }, [blobId])
  return url
}

/** Localised label of a taxonomy entry. */
export function useLabel() {
  const { i18n } = useTranslation()
  const data = useEngineData()
  const lang = i18n.language.startsWith('el') ? 'el' : 'en'
  return {
    lang,
    subcategory: (id: string): string => {
      for (const c of data?.taxonomy.categories ?? []) {
        const s = c.subcategories.find((x) => x.id === id)
        if (s) return s[lang]
      }
      return id
    },
    category: (id: string): string => data?.taxonomy.categories.find((c) => c.id === id)?.[lang] ?? id,
    colour: (id: string): string => data?.palette.colours.find((c) => c.id === id)?.[lang] ?? id,
    pattern: (id: string): string => data?.taxonomy.patterns.find((p) => p.id === id)?.[lang] ?? id,
    material: (id: string): string => data?.taxonomy.materials.find((m) => m.id === id)?.[lang] ?? id,
    occasion: (id: string): string => data?.occasions.occasions.find((o) => o.id === id)?.[lang] ?? id,
    band: (id: string): string => data?.weatherRules.bands.find((b) => b.id === id)?.[lang] ?? id,
    itemName: (item: Pick<ItemRecord, 'colourPrimary' | 'subcategory'>): string => {
      const colour = data?.palette.colours.find((c) => c.id === item.colourPrimary)?.[lang] ?? item.colourPrimary
      let sub = item.subcategory
      for (const c of data?.taxonomy.categories ?? []) {
        const s = c.subcategories.find((x) => x.id === item.subcategory)
        if (s) sub = s[lang]
      }
      return lang === 'el' ? `${sub} ${colour}` : `${colour} ${sub.toLowerCase()}`
    },
  }
}

export function formatDate(date: string, lang: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }): string {
  return new Intl.DateTimeFormat(lang === 'el' ? 'el-GR' : 'en-GB', options).format(new Date(`${date}T12:00:00`))
}
