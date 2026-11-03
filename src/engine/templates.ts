import type { BandId, SlotTemplate } from './types'

export interface TemplatesFile {
  version: number
  bands: Record<BandId, { slots: SlotTemplate[] }>
  occasions: Record<string, Record<string, string | string[]>>
}

/**
 * Slot template for a band, with the occasion's overrides applied:
 * `<slot>: required | optional | none`, `<slot>Accept: [...]`, `tie: slot`.
 */
export function resolveTemplate(templates: TemplatesFile, band: BandId, occasionId: string): SlotTemplate[] {
  const slots = templates.bands[band].slots.map((s) => ({ ...s, accept: [...s.accept] }))
  const overrides = templates.occasions[occasionId] ?? {}
  for (const [key, value] of Object.entries(overrides)) {
    if (key.endsWith('Accept') && Array.isArray(value)) {
      const slot = slots.find((s) => s.id === key.slice(0, -'Accept'.length))
      if (slot) slot.accept = [...value]
      continue
    }
    if (key === 'tie' && value === 'slot') {
      if (!slots.some((s) => s.id === 'tie')) slots.push({ id: 'tie', accept: ['tie'], required: false })
      continue
    }
    const index = slots.findIndex((s) => s.id === key)
    if (index === -1) continue
    if (value === 'none') slots.splice(index, 1)
    else if (value === 'required') slots[index].required = true
    else if (value === 'optional') slots[index].required = false
  }
  return slots
}
