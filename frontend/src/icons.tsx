// Whitelisted icons available to admins for user avatars.
// Adding a new icon: import the lucide component and add an `{ id, label, Component }`
// entry. The id is what gets persisted to Redis; do NOT rename ids in-place once
// they've been chosen by users (you'd orphan their selection).
import type { LucideIcon } from 'lucide-react'
import {
  Cat, Dog, Fish, Bird, Rabbit, Squirrel, Turtle, Bug,
  Apple, Cherry, Grape, Citrus, Carrot, IceCreamCone, Pizza, Coffee, Beer,
  Sun, Moon, Star, Cloud, Flower, Leaf, TreePine, Sprout, Mountain,
  Rocket, Plane, Car, Bike, Ship, Train,
  Music, Headphones, Camera, Gamepad2, Palette, Brush, Book, Trophy,
  Heart, Smile, Ghost, Skull, Crown, Sparkles, Zap, Flame, Anchor, Compass,
} from 'lucide-react'

export interface IconDef {
  id: string
  label: string
  Component: LucideIcon
}

export const ICONS: IconDef[] = [
  // animals
  { id: 'cat',        label: 'Cat',         Component: Cat },
  { id: 'dog',        label: 'Dog',         Component: Dog },
  { id: 'fish',       label: 'Fish',        Component: Fish },
  { id: 'bird',       label: 'Bird',        Component: Bird },
  { id: 'rabbit',     label: 'Rabbit',      Component: Rabbit },
  { id: 'squirrel',   label: 'Squirrel',    Component: Squirrel },
  { id: 'turtle',     label: 'Turtle',      Component: Turtle },
  { id: 'bug',        label: 'Bug',         Component: Bug },
  // food & drink
  { id: 'apple',      label: 'Apple',       Component: Apple },
  { id: 'cherry',     label: 'Cherry',      Component: Cherry },
  { id: 'grape',      label: 'Grape',       Component: Grape },
  { id: 'citrus',     label: 'Citrus',      Component: Citrus },
  { id: 'carrot',     label: 'Carrot',      Component: Carrot },
  { id: 'ice-cream',  label: 'Ice Cream',   Component: IceCreamCone },
  { id: 'pizza',      label: 'Pizza',       Component: Pizza },
  { id: 'coffee',     label: 'Coffee',      Component: Coffee },
  { id: 'beer',       label: 'Beer',        Component: Beer },
  // nature & weather
  { id: 'sun',        label: 'Sun',         Component: Sun },
  { id: 'moon',       label: 'Moon',        Component: Moon },
  { id: 'star',       label: 'Star',        Component: Star },
  { id: 'cloud',      label: 'Cloud',       Component: Cloud },
  { id: 'flower',     label: 'Flower',      Component: Flower },
  { id: 'leaf',       label: 'Leaf',        Component: Leaf },
  { id: 'tree-pine',  label: 'Pine Tree',   Component: TreePine },
  { id: 'sprout',     label: 'Sprout',      Component: Sprout },
  { id: 'mountain',   label: 'Mountain',    Component: Mountain },
  // travel
  { id: 'rocket',     label: 'Rocket',      Component: Rocket },
  { id: 'plane',      label: 'Plane',       Component: Plane },
  { id: 'car',        label: 'Car',         Component: Car },
  { id: 'bike',       label: 'Bike',        Component: Bike },
  { id: 'ship',       label: 'Ship',        Component: Ship },
  { id: 'train',      label: 'Train',       Component: Train },
  // hobbies
  { id: 'music',      label: 'Music',       Component: Music },
  { id: 'headphones', label: 'Headphones',  Component: Headphones },
  { id: 'camera',     label: 'Camera',      Component: Camera },
  { id: 'gamepad',    label: 'Gamepad',     Component: Gamepad2 },
  { id: 'palette',    label: 'Palette',     Component: Palette },
  { id: 'brush',      label: 'Brush',       Component: Brush },
  { id: 'book',       label: 'Book',        Component: Book },
  { id: 'trophy',     label: 'Trophy',      Component: Trophy },
  // symbols
  { id: 'heart',      label: 'Heart',       Component: Heart },
  { id: 'smile',      label: 'Smile',       Component: Smile },
  { id: 'ghost',      label: 'Ghost',       Component: Ghost },
  { id: 'skull',      label: 'Skull',       Component: Skull },
  { id: 'crown',      label: 'Crown',       Component: Crown },
  { id: 'sparkles',   label: 'Sparkles',    Component: Sparkles },
  { id: 'zap',        label: 'Zap',         Component: Zap },
  { id: 'flame',      label: 'Flame',       Component: Flame },
  { id: 'anchor',     label: 'Anchor',      Component: Anchor },
  { id: 'compass',    label: 'Compass',     Component: Compass },
]

const ICON_BY_ID: Record<string, IconDef> = Object.fromEntries(ICONS.map(i => [i.id, i]))

export function getIcon(id: string | undefined | null): IconDef | undefined {
  if (!id) return undefined
  return ICON_BY_ID[id]
}
