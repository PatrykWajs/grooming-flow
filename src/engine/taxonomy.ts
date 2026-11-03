import type { CategoryId, Material, Role, Season } from './types'

export interface TaxonomySubcategory {
  id: string
  en: string
  el: string
  role: Role
  formality: number
  warmth: number
  prompt?: string
}

export interface TaxonomyCategory {
  id: CategoryId
  en: string
  el: string
  subcategories: TaxonomySubcategory[]
}

export interface TaxonomyMaterial {
  id: Material
  en: string
  el: string
  warmth: number
  rain: 'ok' | 'excluded'
}

export interface Taxonomy {
  version: number
  categories: TaxonomyCategory[]
  patterns: { id: string; en: string; el: string; prompt: string }[]
  materials: TaxonomyMaterial[]
}

export function findSubcategory(
  taxonomy: Taxonomy,
  subcategoryId: string,
): { category: TaxonomyCategory; sub: TaxonomySubcategory } | null {
  for (const category of taxonomy.categories) {
    const sub = category.subcategories.find((s) => s.id === subcategoryId)
    if (sub) return { category, sub }
  }
  return null
}

export function roleOf(taxonomy: Taxonomy, subcategoryId: string): Role {
  return findSubcategory(taxonomy, subcategoryId)?.sub.role ?? 'accessory'
}

export function clampWarmth(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)))
}

/** Default warmth and formality for a new item (subcategory + material). */
export function defaultsFor(
  taxonomy: Taxonomy,
  subcategoryId: string,
  material: Material,
): { warmth: number; formality: number; role: Role } {
  const found = findSubcategory(taxonomy, subcategoryId)
  const materialWarmth = taxonomy.materials.find((m) => m.id === material)?.warmth ?? 0
  if (!found) return { warmth: 3, formality: 3, role: 'accessory' }
  const warmth = clampWarmth(found.sub.warmth + (found.sub.role === 'accessory' || found.sub.role === 'belt' ? 0 : materialWarmth))
  return { warmth, formality: found.sub.formality, role: found.sub.role }
}

export function seasonsForWarmth(warmth: number): Season[] {
  switch (clampWarmth(warmth)) {
    case 1:
      return ['summer']
    case 2:
      return ['spring', 'summer', 'autumn']
    case 3:
      return ['spring', 'autumn']
    case 4:
      return ['autumn', 'winter']
    default:
      return ['winter']
  }
}

export function materialRainExcluded(taxonomy: Taxonomy, material: Material): boolean {
  return taxonomy.materials.find((m) => m.id === material)?.rain === 'excluded'
}
