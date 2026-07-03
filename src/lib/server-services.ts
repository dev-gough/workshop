// Single source of truth for the systemd services the dashboard tracks and is
// allowed to read logs from. The services route consumes the full list for its
// dashboard view; the logs routes derive their allow-list of names from it.
export const TRACKED_SERVICES = [
  'workshop',
  'challenge-poller',
  'nginx',
  'postgresql@16-main',
  'jellyfin',
  'plexmediaserver',
  'tailscaled',
  'ssh',
  'minecraft-atm6',
  'minecraft-atm10',
  'minecraft-stoneblock3',
  'minecraft-meatballcraft',
  'minecraft-atm9sky',
  'minecraft-above-beyond',
  'minecraft-star-technology',
];

// Names permitted for log reads/streams (identical set to TRACKED_SERVICES).
export const ALLOWED_SERVICES = TRACKED_SERVICES;
