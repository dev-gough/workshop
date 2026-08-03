import {
  BedDouble, Sofa, Armchair, Table, Archive, Refrigerator, Bath,
  Square, Monitor, Lamp, DoorOpen, Tv, Microwave, WashingMachine,
  type LucideIcon,
} from 'lucide-react';

export const ICON_MAP: Record<string, LucideIcon> = {
  BedDouble, Sofa, Armchair, Table, Archive, Refrigerator, Bath,
  Square, Monitor, Lamp, DoorOpen, Tv, Microwave, WashingMachine,
};

export function getIcon(key: string): LucideIcon {
  return ICON_MAP[key] || Square;
}
