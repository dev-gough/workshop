'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  UserCircle, Music, Share2, Monitor, Volume2,
  Save, Loader, Check, Trash2, RotateCcw, Gamepad2,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useAudio } from '@/components/AudioProvider';
import { useTheme } from '@/components/ThemeProvider';

// ── Helpers ──

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${365 * 86400};SameSite=Lax`;
}

interface ServerSettings {
  musicDirectory: string;
  slskd: { autoIngest: boolean };
  riotGameName: string;
  riotTagLine: string;
  riotRegion: string;
}

// ── Toggle Switch ──

function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center justify-between w-full py-2 group">
      <div>
        <p className="text-sm font-medium text-foreground text-left">{label}</p>
        {description && <p className="text-xs text-muted-foreground text-left">{description}</p>}
      </div>
      <div className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-primary' : 'bg-muted'}`}>
        <motion.div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
          animate={{ left: checked ? 18 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </div>
    </button>
  );
}

// ── Section Card ──

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border/40 bg-muted/20">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-3">
        {children}
      </div>
    </div>
  );
}

// ── Input Row ──

function InputRow({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground w-28 shrink-0">{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3 py-1.5 rounded-md bg-muted/40 border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
      />
    </div>
  );
}

// ── Main Page ──

export default function ProfilePage() {
  const { username, setUsername, volume, setVolumeValue } = useAudio();
  const { theme, toggleTheme } = useTheme();

  // Server settings
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [autoIngest, setAutoIngest] = useState(false);
  const [riotGameName, setRiotGameName] = useState('');
  const [riotTagLine, setRiotTagLine] = useState('');
  const [riotRegion, setRiotRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Client settings
  const [barfooUsername, setBarfooUsername] = useState('');
  const [slskFileTypes, setSlskFileTypes] = useState<string[]>([]);

  const FILE_TYPES = ['flac', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma'];

  // Load settings
  useEffect(() => {
    // Server settings
    fetch('/api/settings').then(r => r.json()).then((data: ServerSettings) => {
      setServerSettings(data);
      setAutoIngest(data.slskd?.autoIngest ?? false);
      setRiotGameName(data.riotGameName || '');
      setRiotTagLine(data.riotTagLine || '');
      setRiotRegion(data.riotRegion || '');
    }).catch(() => {});

    // Client settings
    setBarfooUsername(getCookie('barfoo_user') || '');
    try {
      const types = JSON.parse(localStorage.getItem('slsk_file_types') || 'null');
      setSlskFileTypes(types || FILE_TYPES);
    } catch { setSlskFileTypes(FILE_TYPES); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save server settings
  const saveServerSettings = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoIngest, riotGameName, riotTagLine, riotRegion }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }, [autoIngest, riotGameName, riotTagLine, riotRegion]);

  // Save barfoo username
  const handleUsernameChange = (name: string) => {
    setBarfooUsername(name);
    setCookie('barfoo_user', name);
    setUsername(name);
  };

  // Toggle file type
  const toggleFileType = (ext: string) => {
    setSlskFileTypes(prev => {
      const next = prev.includes(ext) ? prev.filter(t => t !== ext) : [...prev, ext];
      localStorage.setItem('slsk_file_types', JSON.stringify(next));
      return next;
    });
  };

  // Clear data helpers
  const clearRecentSearches = () => {
    localStorage.removeItem('barfoo_recent_searches');
  };

  const clearPlaybackState = () => {
    localStorage.removeItem('barfoo_playback');
  };

  const resetFloatingPlayer = () => {
    localStorage.removeItem('floating-player-position');
  };

  if (!serverSettings) {
    return (
      <PageTransition>
        <div className="bg-background flex items-center justify-center" style={{ minHeight: 'calc(100vh - 57px)' }}>
          <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="bg-background" style={{ minHeight: 'calc(100vh - 57px)' }}>
        <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
          {/* Header */}
          <FadeIn>
            <div className="flex items-center gap-3 mb-2">
              <UserCircle className="h-7 w-7 text-primary" />
              <div>
                <h1 className="text-2xl font-bold text-foreground tracking-tight">Profile & Settings</h1>
                <p className="text-sm text-muted-foreground">Manage your preferences across all projects</p>
              </div>
            </div>
          </FadeIn>

          {/* ── Appearance ── */}
          <FadeIn delay={0.05}>
            <Section icon={Monitor} title="Appearance">
              <Toggle
                checked={theme === 'dark'}
                onChange={() => toggleTheme()}
                label="Dark Mode"
                description="Use dark theme across the site"
              />
            </Section>
          </FadeIn>

          {/* ── Music / BarFoo ── */}
          <FadeIn delay={0.1}>
            <Section icon={Music} title="Music — BarFoo">
              <InputRow
                label="Username"
                value={barfooUsername}
                onChange={handleUsernameChange}
                placeholder="Your display name for play tracking"
              />

              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-28 shrink-0">Volume</span>
                <input
                  type="range"
                  min={0} max={1} step={0.01}
                  value={volume}
                  onChange={e => setVolumeValue(parseFloat(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-xs font-mono text-muted-foreground w-10 text-right">{Math.round(volume * 100)}%</span>
              </div>

              <div className="border-t border-border/30 pt-3 mt-1">
                <p className="text-xs text-muted-foreground mb-2">Data Management</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={clearRecentSearches} className="text-xs px-3 py-1.5 rounded-md bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex items-center gap-1.5">
                    <Trash2 className="h-3 w-3" /> Clear Recent Searches
                  </button>
                  <button onClick={clearPlaybackState} className="text-xs px-3 py-1.5 rounded-md bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex items-center gap-1.5">
                    <Trash2 className="h-3 w-3" /> Clear Playback State
                  </button>
                  <button onClick={resetFloatingPlayer} className="text-xs px-3 py-1.5 rounded-md bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex items-center gap-1.5">
                    <RotateCcw className="h-3 w-3" /> Reset Player Position
                  </button>
                </div>
              </div>
            </Section>
          </FadeIn>

          {/* ── Soulseek ── */}
          <FadeIn delay={0.15}>
            <Section icon={Share2} title="Soulseek">
              <Toggle
                checked={autoIngest}
                onChange={v => setAutoIngest(v)}
                label="Auto-Ingest Downloads"
                description="Automatically organize completed downloads into your music library without manual review"
              />

              <div className="border-t border-border/30 pt-3 mt-1">
                <p className="text-xs text-muted-foreground mb-2">Search File Type Filters</p>
                <div className="flex flex-wrap gap-1.5">
                  {FILE_TYPES.map(ext => (
                    <button
                      key={ext}
                      onClick={() => toggleFileType(ext)}
                      className={`text-xs font-mono px-2.5 py-1 rounded transition-colors ${
                        slskFileTypes.includes(ext)
                          ? ext === 'flac' ? 'bg-amber-400/15 text-amber-400' : 'bg-muted/60 text-foreground'
                          : 'bg-transparent text-muted-foreground/40 line-through'
                      }`}
                    >
                      {ext}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <span className="text-muted-foreground/50">Music directory:</span>
                <span className="font-mono">{serverSettings.musicDirectory}</span>
              </div>
            </Section>
          </FadeIn>

          {/* ── League of Legends ── */}
          <FadeIn delay={0.2}>
            <Section icon={Gamepad2} title="League of Legends">
              <InputRow label="Game Name" value={riotGameName} onChange={setRiotGameName} placeholder="Summoner name" />
              <InputRow label="Tag Line" value={riotTagLine} onChange={setRiotTagLine} placeholder="e.g. NA1" />
              <InputRow label="Region" value={riotRegion} onChange={setRiotRegion} placeholder="e.g. na1" />
            </Section>
          </FadeIn>

          {/* ── Save Button ── */}
          <FadeIn delay={0.25}>
            <div className="flex justify-end pt-2 pb-8">
              <button
                onClick={saveServerSettings}
                disabled={saving}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  saved
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                } disabled:opacity-50`}
              >
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving...' : saved ? 'Saved' : 'Save Settings'}
              </button>
            </div>
          </FadeIn>
        </div>
      </div>
    </PageTransition>
  );
}
