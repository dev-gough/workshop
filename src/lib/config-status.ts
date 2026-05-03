/**
 * Per-project readiness check. Evaluates which projects have all the config
 * they need vs. which require setup. Used by `/setup`, `/projects` (for muted
 * tiles), and individual project pages (early `SetupRequired` render).
 */
import { existsSync } from 'node:fs';
import { getConfig } from './config';

export type ProjectSlug =
  | 'brainfuck'   | 'barfoo'  | 'soulseek'  | 'jellyfin'
  | 'challenges'  | 'server'  | 'splitwiser' | 'polar-clock'
  | 'gol'         | 'house'   | 'image-evolver' | 'ecosystem' | 'neuroevolution';

export interface ProjectStatus {
  slug: ProjectSlug;
  ready: boolean;
  /** Human-readable list of missing items (empty when ready). */
  missing: string[];
  /** Anchor on /setup that addresses the most prominent missing item. */
  setupAnchor: string | null;
}

export function getProjectStatus(slug: ProjectSlug): ProjectStatus {
  const c = getConfig();
  const missing: string[] = [];
  let setupAnchor: string | null = null;

  switch (slug) {
    case 'brainfuck':
      if (!existsSync(c.paths.brainfuckRepo)) missing.push(`BrainFuck repo not found at ${c.paths.brainfuckRepo}`);
      if (!existsSync(c.paths.pythonBin))     missing.push(`Python venv not found at ${c.paths.pythonBin}`);
      if (missing.length) setupAnchor = 'brainfuck';
      break;

    case 'barfoo':
      if (!c.paths.musicDirectory) missing.push('paths.musicDirectory is unset');
      else if (!existsSync(c.paths.musicDirectory)) missing.push(`musicDirectory does not exist on disk: ${c.paths.musicDirectory}`);
      if (missing.length) setupAnchor = 'music';
      break;

    case 'soulseek':
      if (!c.services.slskd) missing.push('slskd is not configured');
      if (!c.paths.musicDirectory) missing.push('musicDirectory is unset (needed for staging downloads)');
      if (missing.length) setupAnchor = c.services.slskd ? 'music' : 'slskd';
      break;

    case 'jellyfin':
      if (!c.services.transmission) missing.push('transmission is not configured');
      if (missing.length) setupAnchor = 'transmission';
      break;

    case 'challenges':
      if (!c.riot) missing.push('riot API key + summoner are not configured');
      if (missing.length) setupAnchor = 'riot';
      break;

    case 'server':
      // Server dashboard works without minecraftServers, but RCON is gated.
      // Treat the project as always ready; per-feature gating happens inside.
      break;

    // Browser-pure projects — no external deps:
    case 'splitwiser':
    case 'polar-clock':
    case 'gol':
    case 'house':
    case 'image-evolver':
    case 'ecosystem':
    case 'neuroevolution':
      break;
  }

  return { slug, ready: missing.length === 0, missing, setupAnchor };
}

export const ALL_PROJECTS: ProjectSlug[] = [
  'brainfuck', 'barfoo', 'soulseek', 'jellyfin', 'challenges', 'server',
  'splitwiser', 'polar-clock', 'gol', 'house',
  'image-evolver', 'ecosystem', 'neuroevolution',
];

export function getAllProjectStatuses(): Record<ProjectSlug, ProjectStatus> {
  const out = {} as Record<ProjectSlug, ProjectStatus>;
  for (const slug of ALL_PROJECTS) out[slug] = getProjectStatus(slug);
  return out;
}
