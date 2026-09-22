export type VisualizerId =
  | 'lacquer'
  | 'garden'
  | 'chladni'
  | 'sleeve'
  | 'terrain'
  | 'tunnel'
  | 'ribbon'
  | 'resonance';

export interface VisualizerDefinition {
  id: VisualizerId;
  label: string;
  author: 'Sol' | 'Polar Clock';
  origin: 'barfoo' | 'polar-clock';
  description: string;
  accent: string;
}

export const VISUALIZERS: readonly VisualizerDefinition[] = [
  {
    id: 'lacquer',
    label: 'Lacquer Bloom',
    author: 'Sol',
    origin: 'barfoo',
    description: 'A record groove seen from inside the wax, with every kick pressing a new ring.',
    accent: 'hsl(350 76% 63%)',
  },
  {
    id: 'garden',
    label: 'Needle Garden',
    author: 'Sol',
    origin: 'barfoo',
    description: 'Equalizer needles imagined as nocturnal stems bending in a bass-heavy wind.',
    accent: 'hsl(39 91% 59%)',
  },
  {
    id: 'chladni',
    label: 'Chladni Dust',
    author: 'Sol',
    origin: 'barfoo',
    description: 'Cymatic sand figures that rewrite their geometry as the frequency balance shifts.',
    accent: 'hsl(174 66% 53%)',
  },
  {
    id: 'sleeve',
    label: 'Sleeve Echo',
    author: 'Sol',
    origin: 'barfoo',
    description: 'The playing sleeve becomes a mirrored light box breathing in time with the room.',
    accent: 'hsl(277 72% 68%)',
  },
  {
    id: 'terrain',
    label: 'Spectral Terrain',
    author: 'Polar Clock',
    origin: 'polar-clock',
    description: 'Recent FFT frames travel into the distance as a topographic memory of the track.',
    accent: 'hsl(202 65% 60%)',
  },
  {
    id: 'tunnel',
    label: 'Frequency Tunnel',
    author: 'Polar Clock',
    origin: 'polar-clock',
    description: 'Spectrum rings freeze, spin, and fly toward the listener when the low end lands.',
    accent: 'hsl(221 65% 64%)',
  },
  {
    id: 'ribbon',
    label: 'Waveform Ribbon',
    author: 'Polar Clock',
    origin: 'polar-clock',
    description: 'Oscilloscope sweeps drift upward into a fading ribbon of the last few seconds.',
    accent: 'hsl(193 58% 62%)',
  },
  {
    id: 'resonance',
    label: 'Resonant Julia',
    author: 'Polar Clock',
    origin: 'polar-clock',
    description: 'Bass and treble steer the constant that decides the fractal’s entire shape.',
    accent: 'hsl(229 62% 67%)',
  },
] as const;

export const DEFAULT_VISUALIZER: VisualizerId = 'lacquer';

export function isVisualizerId(value: string | null): value is VisualizerId {
  return VISUALIZERS.some((visualizer) => visualizer.id === value);
}

export function visualizerById(id: VisualizerId): VisualizerDefinition {
  return VISUALIZERS.find((visualizer) => visualizer.id === id)!;
}
