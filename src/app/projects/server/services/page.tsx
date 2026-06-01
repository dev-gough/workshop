'use client';

import { useState, useEffect, useCallback, useRef, useMemo, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Cpu, MemoryStick, HardDrive, Clock, Activity,
  Play, Square, RotateCcw, ChevronDown, ChevronRight,
  Circle, AlertCircle, Terminal, RefreshCw, Thermometer,
  Network, BarChart3, Send, Check,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import Sparkline from '@/components/charts/sparkline';

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

interface ServiceSpark { xs: number[]; ys: Array<number | null> }

function ServiceRow({ service, onAction, spark }: { service: ServiceInfo; onAction: (name: string, action: string) => Promise<void>; spark?: ServiceSpark }) {
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
      fetchLogs(logSince);
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
  }, [streaming, expanded, service.name, fetchLogs, logSince]);

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
          {spark && spark.xs.length > 1 && (
            <div className="hidden md:block opacity-80" title="CPU% over last 6h">
              <Sparkline xs={spark.xs} ys={spark.ys} width={80} height={20} color="var(--color-brand-maroon)" fill="color-mix(in oklab, var(--color-brand-maroon) 14%, transparent)" />
            </div>
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
                    onClick={async (e) => {
                      e.stopPropagation();
                      const wasStreaming = streaming;
                      if (wasStreaming) setStreaming(false);
                      await onAction(service.name, 'start');
                      if (wasStreaming) setStreaming(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Play className="h-3 w-3" /> Start
                  </button>
                )}
                {service.status === 'running' && !isWorkshop && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const wasStreaming = streaming;
                      if (wasStreaming) setStreaming(false);
                      await onAction(service.name, 'stop');
                      if (wasStreaming) setStreaming(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    <Square className="h-3 w-3" /> Stop
                  </button>
                )}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const wasStreaming = streaming;
                    if (wasStreaming) setStreaming(false);
                    await onAction(service.name, 'restart');
                    if (wasStreaming) setStreaming(true);
                  }}
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

                {/* RCON command input for Minecraft services */}
                {service.name.startsWith('minecraft-') && service.status === 'running' && (
                  <RconInput serviceName={service.name} />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RconInput({ serviceName }: { serviceName: string }) {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<{ cmd: string; response: string; error?: boolean }[]>([]);
  const [sending, setSending] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || sending) return;

    setSending(true);
    setCmdHistory(prev => [cmd, ...prev]);
    setHistoryIndex(-1);
    setCommand('');

    try {
      const res = await fetch('/api/server/rcon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: serviceName, command: cmd }),
      });
      const data = await res.json();
      if (res.ok) {
        setHistory(prev => [...prev, { cmd, response: data.response || '(no output)' }]);
      } else {
        setHistory(prev => [...prev, { cmd, response: data.error || 'Unknown error', error: true }]);
      }
    } catch {
      setHistory(prev => [...prev, { cmd, response: 'Failed to connect', error: true }]);
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const next = Math.min(historyIndex + 1, cmdHistory.length - 1);
        setHistoryIndex(next);
        setCommand(cmdHistory[next]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setCommand(cmdHistory[next]);
      } else {
        setHistoryIndex(-1);
        setCommand('');
      }
    }
  };

  return (
    <div className="space-y-1.5">
      {history.length > 0 && (
        <div className="bg-zinc-950 rounded-lg p-2 max-h-32 overflow-y-auto font-mono text-xs space-y-1">
          {history.map((h, i) => (
            <div key={i}>
              <span className="text-blue-400">&gt; {h.cmd}</span>
              <div className={h.error ? 'text-red-400' : 'text-zinc-400'}>{h.response}</div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={send} className="flex items-center gap-2">
        <div className="flex-1 flex items-center bg-zinc-950 rounded-lg border border-zinc-800 focus-within:border-zinc-600 transition-colors">
          <span className="pl-3 text-zinc-600 font-mono text-xs select-none">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="RCON command..."
            disabled={sending}
            className="flex-1 bg-transparent text-xs font-mono text-zinc-200 placeholder:text-zinc-700 px-2 py-2 outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <button
          type="submit"
          disabled={sending || !command.trim()}
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800 transition-colors"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}


// ── Main Page ──

export default function ServerDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionDone, setActionDone] = useState<string | null>(null);
  const actionIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sparks, setSparks] = useState<Record<string, ServiceSpark>>({});

  // Fetch 6h of CPU% sparkline data for all visible services, refreshed every 60s.
  useEffect(() => {
    if (services.length === 0) return;
    let cancelled = false;
    const fetchSparks = async () => {
      const now = Date.now();
      const from = new Date(now - 6 * 3600 * 1000).toISOString();
      const to = new Date(now).toISOString();
      const labels = services.map((s) => s.name).join(',');
      try {
        const res = await fetch(`/api/server/metrics/v2?kind=process&labels=${encodeURIComponent(labels)}&from=${from}&to=${to}&maxPoints=80`);
        const data = await res.json();
        if (cancelled || !data?.series) return;
        const out: Record<string, ServiceSpark> = {};
        for (const lbl of Object.keys(data.series)) {
          const pts = data.series[lbl] as Array<Record<string, number | string | null>>;
          out[lbl] = {
            xs: pts.map((p) => Math.round(new Date(p.ts as string).getTime() / 1000)),
            ys: pts.map((p) => typeof p.cpuPercent === 'number' ? p.cpuPercent : null),
          };
        }
        setSparks(out);
      } catch { /* ignore */ }
    };
    fetchSparks();
    const t = setInterval(fetchSparks, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [services]);

  const dismissActionOverlay = useCallback(() => {
    actionIdRef.current = null;
    setActionLoading(null);
    setActionDone(null);
  }, []);

  useEffect(() => {
    if (!actionLoading && !actionDone) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismissActionOverlay(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actionLoading, actionDone, dismissActionOverlay]);

  useEffect(() => {
    if (!actionDone) return;
    const t = setTimeout(() => setActionDone(null), 2000);
    return () => clearTimeout(t);
  }, [actionDone]);

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
    const id = `${name}-${action}`;
    actionIdRef.current = id;
    setActionLoading(id);
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
        const servicesRes = await fetch('/api/server/services');
        const servicesData = await servicesRes.json();
        if (servicesData.services) setServices(servicesData.services);
        if (actionIdRef.current === id) setActionDone(id);
      }
    } catch {
      setError(`Failed to ${action} ${name}`);
    }
    if (actionIdRef.current === id) {
      actionIdRef.current = null;
      setActionLoading(null);
    }
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
      <div className="space-y-6">
          {/* Context strip + Live/Refresh */}
          <FadeIn>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                <span className="text-foreground/80">{stats?.hostname ?? 'host'}</span>
                <span className="opacity-40"> // </span>
                <span>{stats?.os}</span>
                <span className="opacity-40"> // </span>
                <span>{stats?.kernel}</span>
                <span className="opacity-40"> // </span>
                <span>{stats?.cpuCount} cores</span>
                {stats && <><span className="opacity-40"> // </span><span>up {formatUptime(stats.uptimeSeconds)}</span></>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] px-3 py-1.5 rounded-md border transition-colors ${
                    autoRefresh
                      ? 'border-[color:var(--ok)]/40 bg-[color:var(--ok)]/10 text-[color:var(--ok)]'
                      : 'border-border/50 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Activity className={`h-3 w-3 ${autoRefresh ? 'animate-pulse' : ''}`} />
                  {autoRefresh ? 'Live' : 'Paused'}
                </button>
                <button
                  onClick={fetchAll}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.15em] px-3 py-1.5 rounded-md border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
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
                  spark={sparks[service.name]}
                />
              ))}
            </div>
          </div>

          {/* Action loading / completion overlay */}
          <AnimatePresence>
            {(actionLoading || actionDone) && (() => {
              const id = (actionLoading ?? actionDone)!;
              const dashIdx = id.indexOf('-');
              const action = id.slice(0, dashIdx);
              const serviceName = id.slice(dashIdx + 1);
              const verbProgressive =
                action === 'stop' ? 'Stopping'
                : action === 'start' ? 'Starting'
                : action === 'restart' ? 'Restarting'
                : `${action}ing`;
              const verbPast =
                action === 'stop' ? 'Stopped'
                : action === 'start' ? 'Started'
                : action === 'restart' ? 'Restarted'
                : `${action}ed`;
              const done = !actionLoading && !!actionDone;
              const isMcStop = serviceName.startsWith('minecraft-') && (action === 'stop' || action === 'restart');
              return (
                <motion.div
                  key="action-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={dismissActionOverlay}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm"
                >
                  <motion.div
                    key={done ? 'done' : 'loading'}
                    initial={{ scale: 0.96, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.96, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={(e) => e.stopPropagation()}
                    className={`flex flex-col items-center gap-4 px-12 py-10 min-w-[420px] max-w-[560px] rounded-2xl bg-card border shadow-2xl ${done ? 'border-emerald-500/40' : 'border-border'}`}
                  >
                    <div className={`flex h-14 w-14 items-center justify-center rounded-full ${done ? 'bg-emerald-500/15 text-emerald-500' : 'bg-primary/10 text-primary'}`}>
                      {done
                        ? <Check className="h-7 w-7" />
                        : <RefreshCw className="h-7 w-7 animate-spin" />
                      }
                    </div>
                    <div className="flex flex-col items-center gap-1 text-center">
                      <div className="text-lg font-semibold">
                        {done ? verbPast : verbProgressive} <span className="font-mono">{serviceName}</span>
                      </div>
                      {!done && (
                        <div className="text-sm text-muted-foreground">
                          {isMcStop
                            ? 'Sending /stop via RCON and waiting for a clean save. This can take a while.'
                            : 'Waiting for systemd to finish the action.'}
                        </div>
                      )}
                      {!done && (
                        <div className="mt-2 text-xs text-muted-foreground/80">
                          Press Esc or click outside to dismiss — the action continues in the background.
                        </div>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              );
            })()}
          </AnimatePresence>
      </div>
    </PageTransition>
  );
}
