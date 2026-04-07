'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Server, Cpu, MemoryStick, HardDrive, Clock, Activity,
  Play, Square, RotateCcw, ChevronDown, ChevronRight,
  Circle, AlertCircle, Terminal, RefreshCw, Thermometer,
  Network, BarChart3,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';

// ── Types ──

interface SystemStats {
  hostname: string;
  os: string;
  kernel: string;
  cpuCount: number;
  cpuTemp: number | null;
  loadAverage: { '1m': number; '5m': number; '15m': number };
  cpuUsage: number;
  perCoreUsage: number[];
  memory: { total: number; used: number; available: number; percentUsed: number };
  swap: { total: number; used: number; free: number };
  disks: { device: string; total: number; used: number; available: number; percentUsed: number; mountPoint: string }[];
  uptimeSeconds: number;
}

interface ServiceEndpoint {
  port: number;
  protocol?: string;
  label?: string;
}

interface ServiceInfo {
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'failed' | 'unknown';
  enabled: boolean;
  description: string;
  activeState: string;
  subState: string;
  pid: number | null;
  memory: string | null;
  uptime: string | null;
  startedAt: string | null;
  endpoints: ServiceEndpoint[] | null;
}

interface LogLine {
  timestamp: string;
  hostname: string;
  unit: string;
  message: string;
}

// ── Helpers ──

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes < 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'text-emerald-400';
    case 'stopped': return 'text-zinc-500';
    case 'failed': return 'text-red-400';
    default: return 'text-zinc-600';
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'running': return 'bg-emerald-400/10';
    case 'stopped': return 'bg-zinc-400/10';
    case 'failed': return 'bg-red-400/10';
    default: return 'bg-zinc-400/10';
  }
}

function usageColor(percent: number): string {
  if (percent >= 90) return '#ef4444';
  if (percent >= 70) return '#f59e0b';
  if (percent >= 50) return '#3b82f6';
  return '#22c55e';
}

// ── Components ──

function UsageBar({ percent, label, detail, color }: { percent: number; label: string; detail: string; color?: string }) {
  const barColor = color || usageColor(percent);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{detail}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: barColor }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(percent, 100)}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold font-mono text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ServiceRow({ service, onAction }: { service: ServiceInfo; onAction: (name: string, action: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSince, setLogSince] = useState('1h');
  const [streaming, setStreaming] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const autoScrollRef = useRef(true);

  const fetchLogs = useCallback(async (since: string) => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/server/logs?service=${service.name}&lines=200&since=${since}`);
      const data = await res.json();
      if (data.lines) setLogs(data.lines);
    } catch { /* ignore */ }
    setLogsLoading(false);
  }, [service.name]);

  // Track whether user has scrolled up (disable auto-scroll)
  const handleLogScroll = useCallback(() => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, []);

  // Connect/disconnect SSE stream
  useEffect(() => {
    if (streaming && expanded) {
      const es = new EventSource(`/api/server/logs/stream?service=${service.name}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const line: LogLine = JSON.parse(event.data);
          setLogs(prev => {
            const next = [...prev, line];
            // Cap at 500 lines to avoid memory bloat
            return next.length > 500 ? next.slice(-500) : next;
          });
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        // EventSource auto-reconnects, nothing extra needed
      };

      return () => {
        es.close();
        eventSourceRef.current = null;
      };
    } else {
      // Not streaming — close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [streaming, expanded, service.name]);

  // Auto-scroll to bottom when new logs arrive (if user hasn't scrolled up)
  useEffect(() => {
    const el = logContainerRef.current;
    if (autoScrollRef.current && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (expanded) {
      fetchLogs(logSince);
    }
    if (!expanded) {
      setStreaming(false);
    }
  }, [expanded, logSince, fetchLogs]);

  const isWorkshop = service.name === 'workshop';

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <Circle className={`h-2.5 w-2.5 fill-current shrink-0 ${statusColor(service.status)}`} />
          <span className="font-medium text-sm truncate">{service.displayName}</span>
          <span className="text-xs text-muted-foreground font-mono hidden sm:inline">({service.name})</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {service.endpoints && service.status === 'running' && (
            <span className="text-xs font-mono text-muted-foreground hidden md:inline">
              {service.endpoints.map(ep =>
                ep.protocol === 'http'
                  ? `${ep.protocol}://192.168.2.15:${ep.port}`
                  : `192.168.2.15:${ep.port}`
              ).join(', ')}
            </span>
          )}
          {service.memory && (
            <span className="text-xs font-mono text-muted-foreground hidden md:inline">{service.memory}</span>
          )}
          {service.pid && (
            <span className="text-xs font-mono text-muted-foreground hidden lg:inline">PID {service.pid}</span>
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBg(service.status)} ${statusColor(service.status)}`}>
            {service.status}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-3 space-y-3">
              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground mr-1">Actions:</span>
                {service.status !== 'running' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onAction(service.name, 'start'); }}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Play className="h-3 w-3" /> Start
                  </button>
                )}
                {service.status === 'running' && !isWorkshop && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onAction(service.name, 'stop'); }}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    <Square className="h-3 w-3" /> Stop
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onAction(service.name, 'restart'); }}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" /> Restart
                </button>
                {isWorkshop && service.status === 'running' && (
                  <span className="text-xs text-muted-foreground italic ml-1">Stop disabled (self-hosted)</span>
                )}
              </div>

              {/* Service details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">State: </span>
                  <span className="font-mono">{service.activeState}/{service.subState}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Enabled: </span>
                  <span className="font-mono">{service.enabled ? 'yes' : 'no'}</span>
                </div>
                {service.pid && (
                  <div>
                    <span className="text-muted-foreground">PID: </span>
                    <span className="font-mono">{service.pid}</span>
                  </div>
                )}
                {service.memory && (
                  <div>
                    <span className="text-muted-foreground">Memory: </span>
                    <span className="font-mono">{service.memory}</span>
                  </div>
                )}
                {service.endpoints && service.endpoints.map((ep, i) => (
                  <div key={i}>
                    <span className="text-muted-foreground">{ep.label || 'Endpoint'}: </span>
                    <span className="font-mono">
                      {ep.protocol === 'http' ? (
                        <a href={`http://192.168.2.15:${ep.port}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                          192.168.2.15:{ep.port}
                        </a>
                      ) : (
                        <>192.168.2.15:{ep.port}</>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* Logs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Logs</span>
                    {streaming && (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        live
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {['30m', '1h', '6h', '1d'].map(s => (
                      <button
                        key={s}
                        onClick={(e) => { e.stopPropagation(); setLogSince(s); }}
                        className={`text-xs px-2 py-0.5 rounded transition-colors ${
                          logSince === s
                            ? 'bg-primary/20 text-primary'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                    <button
                      onClick={(e) => { e.stopPropagation(); setStreaming(s => !s); }}
                      className={`text-xs px-2 py-0.5 rounded transition-colors ${
                        streaming
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      {streaming ? 'Stop' : 'Stream'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); fetchLogs(logSince); }}
                      className="text-xs p-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RefreshCw className={`h-3 w-3 ${logsLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <div ref={logContainerRef} onScroll={handleLogScroll} className="bg-zinc-950 rounded-lg p-3 max-h-80 overflow-y-auto font-mono text-xs leading-relaxed">
                  {logsLoading && logs.length === 0 ? (
                    <div className="text-zinc-500 text-center py-4">Loading logs...</div>
                  ) : logs.length === 0 ? (
                    <div className="text-zinc-500 text-center py-4">No logs in this time range</div>
                  ) : (
                    logs.map((line, i) => (
                      <div key={i} className="hover:bg-zinc-900/50 px-1 -mx-1 rounded">
                        <span className="text-zinc-600 select-none">{line.timestamp ? line.timestamp.substring(11, 19) : ''} </span>
                        <span className={
                          /error|fail|critical|panic/i.test(line.message) ? 'text-red-400' :
                          /warn/i.test(line.message) ? 'text-amber-400' :
                          'text-zinc-300'
                        }>
                          {line.message}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Chart Types ──

interface MetricPoint {
  ts: string;
  data: Record<string, number>;
}

interface MultiSeries {
  [label: string]: MetricPoint[];
}

const RANGE_OPTIONS = [
  { value: '1h', label: '1H' },
  { value: '6h', label: '6H' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
];

const PROCESS_COLORS: Record<string, string> = {
  'workshop': '#818cf8',
  'challenge-poller': '#f472b6',
  'nginx': '#4ade80',
  'postgresql@16-main': '#38bdf8',
  'jellyfin': '#fbbf24',
  'plexmediaserver': '#a78bfa',
  'tailscaled': '#fb923c',
  'ssh': '#94a3b8',
  'minecraft-atm6': '#ef4444',
  'minecraft-atm10': '#f97316',
  'minecraft-stoneblock3': '#84cc16',
  'minecraft-meatballcraft': '#06b6d4',
  'minecraft-atm9sky': '#8b5cf6',
  'minecraft-above-beyond': '#ec4899',
};

function RangeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
      {RANGE_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-xs px-2.5 py-1 rounded-md transition-colors font-medium ${
            value === opt.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// SVG Area Chart with hover tooltip
function AreaChart({
  points, dataKey, color, yMax, height = 160, formatValue, unit,
}: {
  points: MetricPoint[];
  dataKey: string;
  color: string;
  yMax?: number;
  height?: number;
  formatValue?: (v: number) => string;
  unit?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Collecting data...
      </div>
    );
  }

  const values = points.map(p => p.data[dataKey] ?? 0);
  const max = yMax ?? (Math.max(...values) * 1.1 || 1);
  const W = 600;
  const H = height;
  const padTop = 10;
  const padBot = 20;
  const chartH = H - padTop - padBot;

  const xScale = (i: number) => (i / (points.length - 1)) * W;
  const yScale = (v: number) => padTop + chartH - (v / max) * chartH;

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L${W},${padTop + chartH} L0,${padTop + chartH} Z`;

  // Hover gridlines: show ~5 time labels
  const tickCount = Math.min(5, points.length);
  const tickStep = Math.floor(points.length / tickCount);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(idx, points.length - 1)));
  };

  const fmt = formatValue || ((v: number) => v.toFixed(1));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const y = padTop + chartH * (1 - frac);
        return (
          <g key={frac}>
            <line x1={0} y1={y} x2={W} y2={y} stroke="currentColor" strokeOpacity={0.06} />
            <text x={4} y={y - 3} fill="currentColor" fillOpacity={0.3} fontSize={9} fontFamily="monospace">
              {fmt(max * frac)}{unit || ''}
            </text>
          </g>
        );
      })}

      {/* Time labels */}
      {Array.from({ length: tickCount }, (_, i) => {
        const idx = i * tickStep;
        if (idx >= points.length) return null;
        const x = xScale(idx);
        const t = new Date(points[idx].ts);
        const label = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
        return (
          <text key={i} x={x} y={H - 4} fill="currentColor" fillOpacity={0.3} fontSize={9} fontFamily="monospace" textAnchor="middle">
            {label}
          </text>
        );
      })}

      {/* Area fill */}
      <path d={areaPath} fill={color} fillOpacity={0.12} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />

      {/* Hover indicator */}
      {hoverIdx !== null && (
        <>
          <line x1={xScale(hoverIdx)} y1={padTop} x2={xScale(hoverIdx)} y2={padTop + chartH} stroke={color} strokeOpacity={0.4} strokeDasharray="3,3" />
          <circle cx={xScale(hoverIdx)} cy={yScale(values[hoverIdx])} r={3} fill={color} stroke="var(--color-card)" strokeWidth={2} />
          <rect
            x={Math.min(xScale(hoverIdx) + 8, W - 100)} y={Math.max(yScale(values[hoverIdx]) - 28, 2)}
            width={92} height={22} rx={4} fill="var(--color-card)" stroke={color} strokeOpacity={0.3} strokeWidth={1}
          />
          <text
            x={Math.min(xScale(hoverIdx) + 14, W - 94)} y={Math.max(yScale(values[hoverIdx]) - 12, 18)}
            fill="currentColor" fontSize={10} fontFamily="monospace"
          >
            {fmt(values[hoverIdx])}{unit || ''} · {new Date(points[hoverIdx].ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </text>
        </>
      )}
    </svg>
  );
}

// Multi-line chart for per-process data
function MultiLineChart({
  series, dataKey, colors, yMax, height = 200, formatValue, unit,
}: {
  series: MultiSeries;
  dataKey: string;
  colors: Record<string, string>;
  yMax?: number;
  height?: number;
  formatValue?: (v: number) => string;
  unit?: string;
}) {
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [hiddenLabels, setHiddenLabels] = useState<Set<string>>(new Set());
  const labels = Object.keys(series);
  const visibleLabels = labels.filter(l => !hiddenLabels.has(l));

  const allValues = labels.flatMap(l => series[l].map(p => p.data[dataKey] ?? 0));
  const max = yMax ?? (Math.max(...allValues) * 1.1 || 1);
  const W = 600;
  const H = height;
  const padTop = 10;
  const padBot = 20;
  const chartH = H - padTop - padBot;

  if (labels.length === 0 || allValues.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Collecting data...
      </div>
    );
  }

  // Find global time range
  const allTimes = labels.flatMap(l => series[l].map(p => new Date(p.ts).getTime()));
  const minT = Math.min(...allTimes);
  const maxT = Math.max(...allTimes);
  const timeRange = maxT - minT || 1;

  const xScale = (t: number) => ((t - minT) / timeRange) * W;
  const yScale = (v: number) => padTop + chartH - (v / max) * chartH;
  const fmt = formatValue || ((v: number) => v.toFixed(1));

  // Time labels
  const tickCount = 5;

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = padTop + chartH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={0} y1={y} x2={W} y2={y} stroke="currentColor" strokeOpacity={0.06} />
              <text x={4} y={y - 3} fill="currentColor" fillOpacity={0.3} fontSize={9} fontFamily="monospace">
                {fmt(max * frac)}{unit || ''}
              </text>
            </g>
          );
        })}

        {/* Time labels */}
        {Array.from({ length: tickCount }, (_, i) => {
          const t = minT + (timeRange * i) / (tickCount - 1);
          const d = new Date(t);
          return (
            <text key={i} x={xScale(t)} y={H - 4} fill="currentColor" fillOpacity={0.3} fontSize={9} fontFamily="monospace" textAnchor="middle">
              {d.getHours().toString().padStart(2, '0')}:{d.getMinutes().toString().padStart(2, '0')}
            </text>
          );
        })}

        {/* Lines */}
        {visibleLabels.map(label => {
          const pts = series[label];
          if (pts.length < 2) return null;
          const color = colors[label] || '#888';
          const isHovered = hoverLabel === label;
          const opacity = hoverLabel === null ? 0.8 : isHovered ? 1 : 0.15;
          const path = pts.map((p, i) => {
            const x = xScale(new Date(p.ts).getTime());
            const y = yScale(p.data[dataKey] ?? 0);
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ');

          return (
            <path key={label} d={path} fill="none" stroke={color} strokeWidth={isHovered ? 2.5 : 1.5}
              strokeLinecap="round" strokeLinejoin="round" opacity={opacity} style={{ transition: 'opacity 0.2s, stroke-width 0.2s' }} />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
        {labels.map(label => {
          const color = colors[label] || '#888';
          const lastVal = series[label][series[label].length - 1]?.data[dataKey] ?? 0;
          const isHidden = hiddenLabels.has(label);
          return (
            <button
              key={label}
              className={`flex items-center gap-1.5 text-xs transition-opacity ${
                isHidden ? 'opacity-30' : hoverLabel !== null && hoverLabel !== label ? 'opacity-30' : ''
              }`}
              onClick={() => setHiddenLabels(prev => {
                const next = new Set(prev);
                if (next.has(label)) next.delete(label);
                else next.add(label);
                return next;
              })}
              onMouseEnter={() => !isHidden && setHoverLabel(label)}
              onMouseLeave={() => setHoverLabel(null)}
            >
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }} />
              <span className={`text-muted-foreground ${isHidden ? 'line-through' : ''}`}>{label.replace(/@.*/, '')}</span>
              {!isHidden && <span className="font-mono text-foreground">{fmt(lastVal)}{unit || ''}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Delta chart for network/disk (compute rate from cumulative counters)
function RateChart({
  points, rxKey, txKey, height = 160, color1 = '#38bdf8', color2 = '#4ade80',
  label1 = 'In', label2 = 'Out',
}: {
  points: MetricPoint[];
  rxKey: string;
  txKey: string;
  height?: number;
  color1?: string;
  color2?: string;
  label1?: string;
  label2?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);

  // Compute rates (bytes/sec) from cumulative counters
  const rates: { ts: string; rx: number; tx: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = (new Date(points[i].ts).getTime() - new Date(points[i - 1].ts).getTime()) / 1000;
    if (dt <= 0) continue;
    const rx = ((points[i].data[rxKey] ?? 0) - (points[i - 1].data[rxKey] ?? 0)) / dt;
    const tx = ((points[i].data[txKey] ?? 0) - (points[i - 1].data[txKey] ?? 0)) / dt;
    // Skip negative values (counter reset)
    if (rx >= 0 && tx >= 0) {
      rates.push({ ts: points[i].ts, rx, tx });
    }
  }

  if (rates.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Collecting data...
      </div>
    );
  }

  const allVals = rates.flatMap(r => [r.rx, r.tx]);
  const max = (Math.max(...allVals) * 1.1) || 1;
  const W = 600;
  const H = height;
  const padTop = 10;
  const padBot = 20;
  const chartH = H - padTop - padBot;

  const xScale = (i: number) => (i / (rates.length - 1)) * W;
  const yScale = (v: number) => padTop + chartH - (v / max) * chartH;

  function makePath(vals: number[]) {
    return vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
  }

  const rxPath = makePath(rates.map(r => r.rx));
  const txPath = makePath(rates.map(r => r.tx));
  const rxArea = rxPath + ` L${W},${padTop + chartH} L0,${padTop + chartH} Z`;
  const txArea = txPath + ` L${W},${padTop + chartH} L0,${padTop + chartH} Z`;

  function fmtRate(bytesPerSec: number): string {
    if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
    if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    setHoverIdx(Math.max(0, Math.min(Math.round(ratio * (rates.length - 1)), rates.length - 1)));
  };

  const tickCount = Math.min(5, rates.length);
  const tickStep = Math.floor(rates.length / tickCount);

  return (
    <div className="space-y-2">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}
        onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(frac => {
          const y = padTop + chartH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={0} y1={y} x2={W} y2={y} stroke="currentColor" strokeOpacity={0.06} />
              <text x={4} y={y - 3} fill="currentColor" fillOpacity={0.3} fontSize={9} fontFamily="monospace">
                {fmtRate(max * frac)}
              </text>
            </g>
          );
        })}

        {/* Time labels */}
        {Array.from({ length: tickCount }, (_, i) => {
          const idx = i * tickStep;
          if (idx >= rates.length) return null;
          const t = new Date(rates[idx].ts);
          return (
            <text key={i} x={xScale(idx)} y={H - 4} fill="currentColor" fillOpacity={0.3} fontSize={9} fontFamily="monospace" textAnchor="middle">
              {t.getHours().toString().padStart(2, '0')}:{t.getMinutes().toString().padStart(2, '0')}
            </text>
          );
        })}

        {!hiddenSeries.has('rx') && <>
          <path d={rxArea} fill={color1} fillOpacity={0.08} />
          <path d={rxPath} fill="none" stroke={color1} strokeWidth={1.5} strokeLinecap="round" />
        </>}
        {!hiddenSeries.has('tx') && <>
          <path d={txArea} fill={color2} fillOpacity={0.08} />
          <path d={txPath} fill="none" stroke={color2} strokeWidth={1.5} strokeLinecap="round" />
        </>}

        {hoverIdx !== null && (
          <>
            <line x1={xScale(hoverIdx)} y1={padTop} x2={xScale(hoverIdx)} y2={padTop + chartH} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="3,3" />
            {!hiddenSeries.has('rx') && <circle cx={xScale(hoverIdx)} cy={yScale(rates[hoverIdx].rx)} r={3} fill={color1} stroke="var(--color-card)" strokeWidth={2} />}
            {!hiddenSeries.has('tx') && <circle cx={xScale(hoverIdx)} cy={yScale(rates[hoverIdx].tx)} r={3} fill={color2} stroke="var(--color-card)" strokeWidth={2} />}
          </>
        )}
      </svg>

      <div className="flex items-center gap-4 px-1 text-xs">
        <button
          className={`flex items-center gap-1.5 transition-opacity ${hiddenSeries.has('rx') ? 'opacity-30' : ''}`}
          onClick={() => setHiddenSeries(prev => {
            const next = new Set(prev);
            if (next.has('rx')) next.delete('rx');
            else next.add('rx');
            return next;
          })}
        >
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color1, opacity: hiddenSeries.has('rx') ? 0.3 : 1 }} />
          <span className={`text-muted-foreground ${hiddenSeries.has('rx') ? 'line-through' : ''}`}>{label1}</span>
          {hoverIdx !== null && !hiddenSeries.has('rx') && <span className="font-mono">{fmtRate(rates[hoverIdx].rx)}</span>}
        </button>
        <button
          className={`flex items-center gap-1.5 transition-opacity ${hiddenSeries.has('tx') ? 'opacity-30' : ''}`}
          onClick={() => setHiddenSeries(prev => {
            const next = new Set(prev);
            if (next.has('tx')) next.delete('tx');
            else next.add('tx');
            return next;
          })}
        >
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color2, opacity: hiddenSeries.has('tx') ? 0.3 : 1 }} />
          <span className={`text-muted-foreground ${hiddenSeries.has('tx') ? 'line-through' : ''}`}>{label2}</span>
          {hoverIdx !== null && !hiddenSeries.has('tx') && <span className="font-mono">{fmtRate(rates[hoverIdx].tx)}</span>}
        </button>
        {hoverIdx !== null && (
          <span className="text-muted-foreground font-mono ml-auto">
            {new Date(rates[hoverIdx].ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, icon: Icon, children, range, onRangeChange }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
  range: string; onRangeChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </div>
        <RangeSelector value={range} onChange={onRangeChange} />
      </div>
      {children}
    </div>
  );
}

function HistorySection() {
  const [range, setRange] = useState('1h');
  const [cpuData, setCpuData] = useState<MetricPoint[]>([]);
  const [memData, setMemData] = useState<MetricPoint[]>([]);
  const [tempData, setTempData] = useState<MetricPoint[]>([]);
  const [netData, setNetData] = useState<MetricPoint[]>([]);
  const [diskData, setDiskData] = useState<MetricPoint[]>([]);
  const [processSeries, setProcessSeries] = useState<MultiSeries>({});
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const [cpu, mem, temp, net, disk, proc] = await Promise.all([
        fetch(`/api/server/metrics?kind=system&label=cpu&range=${range}`).then(r => r.json()),
        fetch(`/api/server/metrics?kind=system&label=memory&range=${range}`).then(r => r.json()),
        fetch(`/api/server/metrics?kind=system&label=temperature&range=${range}`).then(r => r.json()),
        fetch(`/api/server/metrics/multi?kind=network&range=${range}`).then(r => r.json()),
        fetch(`/api/server/metrics/multi?kind=disk&range=${range}`).then(r => r.json()),
        fetch(`/api/server/metrics/multi?kind=process&range=${range}`).then(r => r.json()),
      ]);
      if (cpu.points) setCpuData(cpu.points);
      if (mem.points) setMemData(mem.points);
      if (temp.points) setTempData(temp.points);
      // For network, pick the main interface (first non-tailscale)
      if (net.series) {
        const mainIface = net.labels?.find((l: string) => !l.startsWith('tailscale')) || net.labels?.[0];
        if (mainIface && net.series[mainIface]) setNetData(net.series[mainIface]);
      }
      // For disk, pick the main disk
      if (disk.series) {
        const mainDisk = disk.labels?.find((l: string) => l === 'sdb') || disk.labels?.[0];
        if (mainDisk && disk.series[mainDisk]) setDiskData(disk.series[mainDisk]);
      }
      if (proc.series) setProcessSeries(proc.series);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
    setLoading(false);
  }, [range]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Refresh every 60s
  useEffect(() => {
    const interval = setInterval(fetchHistory, 60000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  const fmtMB = (v: number) => (v / (1024 * 1024)).toFixed(0);
  const fmtGB = (v: number) => (v / (1024 * 1024 * 1024)).toFixed(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium px-1">
        <BarChart3 className="h-4 w-4 text-primary" />
        History
        {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CPU Load */}
        <ChartCard title="CPU Load" icon={Cpu} range={range} onRangeChange={setRange}>
          <AreaChart points={cpuData} dataKey="load1" color="#818cf8" formatValue={v => v.toFixed(2)} />
        </ChartCard>

        {/* Memory Usage */}
        <ChartCard title="Memory" icon={MemoryStick} range={range} onRangeChange={setRange}>
          <AreaChart
            points={memData} dataKey="percentUsed" color="#38bdf8"
            yMax={100} formatValue={v => v.toFixed(1)} unit="%"
          />
        </ChartCard>

        {/* Temperature */}
        <ChartCard title="CPU Temperature" icon={Thermometer} range={range} onRangeChange={setRange}>
          <AreaChart points={tempData} dataKey="cpu" color="#fbbf24" formatValue={v => v.toFixed(1)} unit="°" />
        </ChartCard>

        {/* Network I/O */}
        <ChartCard title="Network I/O" icon={Network} range={range} onRangeChange={setRange}>
          <RateChart points={netData} rxKey="rxBytes" txKey="txBytes" color1="#38bdf8" color2="#4ade80" label1="Download" label2="Upload" />
        </ChartCard>

        {/* Disk I/O */}
        <ChartCard title="Disk I/O" icon={HardDrive} range={range} onRangeChange={setRange}>
          <RateChart points={diskData} rxKey="sectorsRead" txKey="sectorsWritten" color1="#a78bfa" color2="#fb923c" label1="Read" label2="Write" />
        </ChartCard>

        {/* Per-Process Memory */}
        <ChartCard title="Process Memory" icon={Activity} range={range} onRangeChange={setRange}>
          <MultiLineChart
            series={processSeries} dataKey="memoryBytes" colors={PROCESS_COLORS}
            formatValue={v => (v / (1024 * 1024)).toFixed(0)} unit=" MB"
            height={200}
          />
        </ChartCard>

        {/* Per-Process CPU */}
        <div className="lg:col-span-2">
          <ChartCard title="Process CPU Usage" icon={Cpu} range={range} onRangeChange={setRange}>
            <MultiLineChart
              series={processSeries} dataKey="cpuPercent" colors={PROCESS_COLORS}
              formatValue={v => v.toFixed(1)} unit="%" yMax={undefined}
              height={180}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function ServerDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, servicesRes] = await Promise.all([
        fetch('/api/server'),
        fetch('/api/server/services'),
      ]);
      const statsData = await statsRes.json();
      const servicesData = await servicesRes.json();
      if (statsData.hostname) setStats(statsData);
      if (servicesData.services) setServices(servicesData.services);
      setError(null);
    } catch (err) {
      setError('Failed to connect to server API');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchAll]);

  const handleServiceAction = async (name: string, action: string) => {
    if (actionLoading) return;
    setActionLoading(`${name}-${action}`);
    try {
      const res = await fetch('/api/server/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: name, action }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        // Refresh services
        const servicesRes = await fetch('/api/server/services');
        const servicesData = await servicesRes.json();
        if (servicesData.services) setServices(servicesData.services);
      }
    } catch {
      setError(`Failed to ${action} ${name}`);
    }
    setActionLoading(null);
  };

  if (loading) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex items-center gap-3 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span>Connecting to server...</span>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="p-4 sm:p-8">
        <div className="container mx-auto max-w-6xl space-y-6">
          {/* Header */}
          <FadeIn>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Server className="h-5 w-5 text-primary" />
                  </div>
                  <h1 className="text-2xl font-bold">{stats?.hostname || 'Server'}</h1>
                </div>
                <p className="text-sm text-muted-foreground">
                  {stats?.os} &middot; {stats?.kernel} &middot; {stats?.cpuCount} cores
                  {stats ? ` \u00b7 up ${formatUptime(stats.uptimeSeconds)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    autoRefresh
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Activity className={`h-3 w-3 ${autoRefresh ? 'animate-pulse' : ''}`} />
                  {autoRefresh ? 'Live' : 'Paused'}
                </button>
                <button
                  onClick={fetchAll}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh
                </button>
              </div>
            </div>
          </FadeIn>

          {/* Error banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-auto text-xs hover:underline">Dismiss</button>
              </motion.div>
            )}
          </AnimatePresence>

          {stats && (
            <>
              {/* Quick stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={Cpu}
                  label="CPU Load"
                  value={`${stats.loadAverage['1m'].toFixed(2)}`}
                  sub={`${stats.loadAverage['5m'].toFixed(2)} / ${stats.loadAverage['15m'].toFixed(2)} (5m/15m)`}
                />
                <StatCard
                  icon={MemoryStick}
                  label="Memory"
                  value={`${stats.memory.percentUsed}%`}
                  sub={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
                />
                <StatCard
                  icon={HardDrive}
                  label="Disk"
                  value={`${stats.disks[0]?.percentUsed ?? 0}%`}
                  sub={`${formatBytes(stats.disks[0]?.used ?? 0)} / ${formatBytes(stats.disks[0]?.total ?? 0)}`}
                />
                <StatCard
                  icon={stats.cpuTemp !== null ? Thermometer : Clock}
                  label={stats.cpuTemp !== null ? 'CPU Temp' : 'Uptime'}
                  value={stats.cpuTemp !== null ? `${stats.cpuTemp.toFixed(1)}\u00b0C` : formatUptime(stats.uptimeSeconds)}
                  sub={stats.cpuTemp !== null ? `Uptime: ${formatUptime(stats.uptimeSeconds)}` : `Since boot`}
                />
              </div>

              {/* Resource details */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Memory & Swap */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MemoryStick className="h-4 w-4 text-primary" />
                    Memory
                  </div>
                  <UsageBar
                    percent={stats.memory.percentUsed}
                    label="RAM"
                    detail={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
                  />
                  {stats.swap.total > 0 && (
                    <UsageBar
                      percent={stats.swap.total > 0 ? Math.round((stats.swap.used / stats.swap.total) * 100) : 0}
                      label="Swap"
                      detail={`${formatBytes(stats.swap.used)} / ${formatBytes(stats.swap.total)}`}
                    />
                  )}
                </div>

                {/* CPU cores */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Cpu className="h-4 w-4 text-primary" />
                    CPU Cores
                    <span className="text-xs text-muted-foreground font-normal ml-auto">
                      Load: {stats.loadAverage['1m'].toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {stats.perCoreUsage.map((usage, i) => (
                      <UsageBar
                        key={i}
                        percent={usage}
                        label={`Core ${i}`}
                        detail={`${usage}%`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Disks */}
              {stats.disks.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <HardDrive className="h-4 w-4 text-primary" />
                    Storage
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {stats.disks.map((disk, i) => (
                      <UsageBar
                        key={i}
                        percent={disk.percentUsed}
                        label={`${disk.mountPoint} (${disk.device})`}
                        detail={`${formatBytes(disk.used)} / ${formatBytes(disk.total)}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Services */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium px-1">
              <Activity className="h-4 w-4 text-primary" />
              Services
              <span className="text-xs text-muted-foreground font-normal">
                {services.filter(s => s.status === 'running').length}/{services.length} running
              </span>
            </div>
            <div className="space-y-2">
              {services.map((service) => (
                <ServiceRow
                  key={service.name}
                  service={service}
                  onAction={handleServiceAction}
                />
              ))}
            </div>
          </div>

          {/* History Charts */}
          <HistorySection />

          {/* Action loading overlay */}
          <AnimatePresence>
            {actionLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm"
              >
                <div className="flex items-center gap-3 px-6 py-4 rounded-xl bg-card border border-border shadow-xl">
                  <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm font-medium">
                    {actionLoading.split('-').slice(1).join('-')}ing {actionLoading.split('-')[0]}...
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageTransition>
  );
}
