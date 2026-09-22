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
    description: 'Each kick presses a new ring into the wax.',
    accent: 'hsl(350 76% 63%)',
  },
  {
    id: 'garden',
    label: 'Needle Garden',
    author: 'Sol',
    origin: 'barfoo',
    description: 'Equalizer needles growing in bass-heavy wind.',
    accent: 'hsl(39 91% 59%)',
  },
  {
    id: 'chladni',
    label: 'Chladni Dust',
    author: 'Sol',
    origin: 'barfoo',
    description: 'Cymatic dust redrawn by the frequency balance.',
    accent: 'hsl(174 66% 53%)',
  },
  {
    id: 'sleeve',
    label: 'Sleeve Echo',
    author: 'Sol',
    origin: 'barfoo',
    description: 'The playing sleeve, mirrored and breathing.',
    accent: 'hsl(277 72% 68%)',
  },
  {
    id: 'terrain',
    label: 'Spectral Terrain',
    author: 'Polar Clock',
    origin: 'polar-clock',
    description: 'Recent spectra become a receding landscape.',
    accent: 'hsl(202 65% 60%)',
  },
  {
    id: 'tunnel',
    label: 'Frequency Tunnel',
    author: 'Polar Clock',
    origin: 'polar-clock',
    description: 'Spectrum rings fly outward on the low end.',
    accent: 'hsl(221 65% 64%)',
  },
  {
    id: 'ribbon',
    label: 'Waveform Ribbon',
    author: 'Polar Clock',
    origin: 'polar-clock',
    description: 'Old oscilloscope sweeps become a fading ribbon.',
    accent: 'hsl(193 58% 62%)',
  },
  {
    id: 'resonance',
    label: 'Resonant Julia',
    author: 'Polar Clock',
    origin: 'polar-clock',
    description: 'Bass and treble reshape a Julia fractal.',
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
