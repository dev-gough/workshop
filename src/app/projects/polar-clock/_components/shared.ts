// ── Helpers ─────────────────────────────────────────────────────
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
export function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=31536000`;
}

// ── Color palettes ──────────────────────────────────────────────
export const PALETTES: Record<string, { name: string; colors: string[] }> = {
  default: {
    name: 'Indigo Teal',
    colors: ['hsl(225,70%,60%)', 'hsl(172,66%,45%)', 'hsl(350,80%,62%)', 'hsl(45,93%,55%)', 'hsl(280,65%,62%)', 'hsl(160,60%,45%)', 'hsl(30,80%,55%)'],
  },
  sunset: {
    name: 'Sunset',
    colors: ['hsl(350,85%,60%)', 'hsl(25,90%,55%)', 'hsl(45,95%,55%)', 'hsl(15,80%,50%)', 'hsl(330,70%,55%)', 'hsl(0,75%,60%)', 'hsl(40,85%,50%)'],
  },
  ocean: {
    name: 'Ocean',
    colors: ['hsl(200,80%,50%)', 'hsl(180,70%,45%)', 'hsl(220,75%,55%)', 'hsl(190,65%,50%)', 'hsl(240,60%,60%)', 'hsl(170,60%,45%)', 'hsl(210,70%,50%)'],
  },
  neon: {
    name: 'Neon',
    colors: ['hsl(280,100%,65%)', 'hsl(160,100%,50%)', 'hsl(320,100%,60%)', 'hsl(190,100%,50%)', 'hsl(60,100%,55%)', 'hsl(130,100%,50%)', 'hsl(300,100%,60%)'],
  },
  mono: {
    name: 'Monochrome',
    colors: ['hsl(220,15%,55%)', 'hsl(220,15%,45%)', 'hsl(220,15%,65%)', 'hsl(220,15%,40%)', 'hsl(220,15%,60%)', 'hsl(220,15%,50%)', 'hsl(220,15%,70%)'],
  },
  aurora: {
    name: 'Aurora',
    colors: ['hsl(150,70%,45%)', 'hsl(170,60%,50%)', 'hsl(130,65%,40%)', 'hsl(270,50%,55%)', 'hsl(190,55%,45%)', 'hsl(290,45%,50%)', 'hsl(160,60%,48%)'],
  },
  cyberpunk: {
    name: 'Cyberpunk',
    colors: ['hsl(325,100%,55%)', 'hsl(195,100%,50%)', 'hsl(55,100%,50%)', 'hsl(280,100%,60%)', 'hsl(170,100%,45%)', 'hsl(340,95%,50%)', 'hsl(210,100%,55%)'],
  },
  earth: {
    name: 'Earth',
    colors: ['hsl(15,60%,45%)', 'hsl(140,35%,35%)', 'hsl(35,50%,40%)', 'hsl(25,70%,50%)', 'hsl(160,30%,40%)', 'hsl(45,55%,45%)', 'hsl(10,45%,38%)'],
  },
};

// ── Timezones ───────────────────────────────────────────────────
export const TIMEZONE_OPTIONS = [
  { label: 'New York', value: 'America/New_York' },
  { label: 'Los Angeles', value: 'America/Los_Angeles' },
  { label: 'Chicago', value: 'America/Chicago' },
  { label: 'London', value: 'Europe/London' },
  { label: 'Paris', value: 'Europe/Paris' },
  { label: 'Berlin', value: 'Europe/Berlin' },
  { label: 'Tokyo', value: 'Asia/Tokyo' },
  { label: 'Sydney', value: 'Australia/Sydney' },
  { label: 'Dubai', value: 'Asia/Dubai' },
  { label: 'Mumbai', value: 'Asia/Kolkata' },
  { label: 'Singapore', value: 'Asia/Singapore' },
  { label: 'Hong Kong', value: 'Asia/Hong_Kong' },
  { label: 'Moscow', value: 'Europe/Moscow' },
  { label: 'Sao Paulo', value: 'America/Sao_Paulo' },
  { label: 'Auckland', value: 'Pacific/Auckland' },
  { label: 'Honolulu', value: 'Pacific/Honolulu' },
  { label: 'Denver', value: 'America/Denver' },
  { label: 'Kingston', value: 'America/Toronto' },
  { label: 'Vancouver', value: 'America/Vancouver' },
  { label: 'Seoul', value: 'Asia/Seoul' },
];

export interface RingConfig {
  seconds: boolean;
  minutes: boolean;
  hours: boolean;
  days: boolean;
  months: boolean;
  dayOfYear: boolean;
  weekOfYear: boolean;
}

export interface CitySlot {
  label: string;
  timezone: string;
}
