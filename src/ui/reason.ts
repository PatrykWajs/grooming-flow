import type { TFunction } from 'i18next'
import type { ItemRecord } from '../data/db'
import type { Reason } from '../engine/types'

interface Labels {
  itemName: (item: Pick<ItemRecord, 'colourPrimary' | 'subcategory'>) => string
  band: (id: string) => string
}

/** One readable line from the engine's reason fragments. */
export function composeReason(reasons: Reason[], t: TFunction, labels: Labels, itemsById: Map<string, ItemRecord>): string {
  const parts: string[] = []
  const name = (id: string | number | undefined) => {
    const item = id ? itemsById.get(String(id)) : undefined
    return item ? labels.itemName(item) : ''
  }
  for (const reason of reasons) {
    const p = reason.params ?? {}
    switch (reason.key) {
      case 'reason.weather':
        parts.push(Number(p.rain) >= 40 ? t('today.reason.weatherRain', { min: p.min, max: p.max, rain: p.rain }) : t('today.reason.weather', { min: p.min, max: p.max, band: labels.band(String(p.band)) }))
        break
      case 'reason.rain': {
        const shoes = name(p.shoes)
        const outer = name(p.outer)
        if (shoes && outer) parts.push(t('today.reason.rain', { shoes, outer }))
        else if (shoes) parts.push(t('today.reason.rainShoes', { shoes }))
        break
      }
      case 'reason.sun':
        parts.push(t('today.reason.sun'))
        break
      case 'reason.wind':
        parts.push(t('today.reason.wind'))
        break
      case 'reason.rotation':
        parts.push(t('today.reason.rotation', { item: name(p.item), days: p.days }))
        break
      case 'reason.neverWorn':
        parts.push(t('today.reason.neverWorn', { item: name(p.item) }))
        break
      case 'reason.noWaterproofOuter':
      case 'reason.noWaterproofShoes':
      case 'reason.formalityRelaxed':
        parts.push(t(`today.${reason.key}`))
        break
      case 'reason.slotRelaxed':
        parts.push(t('today.reason.slotRelaxed', { slot: t(`slots.${String(p.slot)}`) }))
        break
      default:
        break
    }
  }
  if (parts.length === 0) return ''
  const [first, ...rest] = parts
  return rest.length ? `${first}: ${rest.join('; ')}.` : `${first}.`
}
