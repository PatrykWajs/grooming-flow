export interface PaletteColour {
  id: string
  hex: string
  /** approximate CIELAB lightness 0..100 */
  l: number
  en: string
  el: string
}

export interface Palette {
  version: number
  families: Record<string, string[]>
  light: string[]
  dark: string[]
  leather: { black: string[]; brown: string[] }
  colours: PaletteColour[]
}

export function colourById(palette: Palette, id: string): PaletteColour | undefined {
  return palette.colours.find((c) => c.id === id)
}

export function lightnessOf(palette: Palette, id: string): number {
  return colourById(palette, id)?.l ?? 50
}

export function familyOf(palette: Palette, id: string): string | null {
  for (const [family, ids] of Object.entries(palette.families)) {
    if (ids.includes(id)) return family
  }
  return null
}

export function leatherFamily(palette: Palette, id: string): 'black' | 'brown' | null {
  if (palette.leather.black.includes(id)) return 'black'
  if (palette.leather.brown.includes(id)) return 'brown'
  return null
}

export function isLight(palette: Palette, id: string): boolean {
  return palette.light.includes(id)
}

export function isDark(palette: Palette, id: string): boolean {
  return palette.dark.includes(id)
}
