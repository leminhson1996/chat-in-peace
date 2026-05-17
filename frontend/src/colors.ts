// Whitelisted avatar background colors available to admins.
// Adding a color: append a new entry. The `id` is persisted to Redis — never
// rename an id in-place; doing so orphans every user that selected it.

export interface ColorDef {
  id: string
  label: string
  hex: string
}

export const COLORS: ColorDef[] = [
  { id: 'indigo',     label: 'Indigo',     hex: '#5865f2' }, // = discord-accent, the default
  { id: 'red',        label: 'Red',        hex: '#ed4245' },
  { id: 'orange',     label: 'Orange',     hex: '#f97316' },
  { id: 'amber',      label: 'Amber',      hex: '#f59e0b' },
  { id: 'yellow',     label: 'Yellow',     hex: '#eab308' },
  { id: 'lime',       label: 'Lime',       hex: '#84cc16' },
  { id: 'green',      label: 'Green',      hex: '#22c55e' },
  { id: 'emerald',    label: 'Emerald',    hex: '#10b981' },
  { id: 'teal',       label: 'Teal',       hex: '#14b8a6' },
  { id: 'cyan',       label: 'Cyan',       hex: '#06b6d4' },
  { id: 'sky',        label: 'Sky',        hex: '#0ea5e9' },
  { id: 'blue',       label: 'Blue',       hex: '#3b82f6' },
  { id: 'violet',     label: 'Violet',     hex: '#8b5cf6' },
  { id: 'purple',     label: 'Purple',     hex: '#a855f7' },
  { id: 'fuchsia',    label: 'Fuchsia',    hex: '#d946ef' },
  { id: 'pink',       label: 'Pink',       hex: '#ec4899' },
  { id: 'rose',       label: 'Rose',       hex: '#f43f5e' },
  { id: 'slate',      label: 'Slate',      hex: '#64748b' },
  { id: 'stone',      label: 'Stone',      hex: '#78716c' },
  { id: 'black',      label: 'Black',      hex: '#1e1f22' },
]

const COLOR_BY_ID: Record<string, ColorDef> = Object.fromEntries(COLORS.map(c => [c.id, c]))

export function getColor(id: string | undefined | null): ColorDef | undefined {
  if (!id) return undefined
  return COLOR_BY_ID[id]
}
