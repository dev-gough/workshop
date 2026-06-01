import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';

export const dynamic = 'force-dynamic';

// One-shot /proc walk. Used by the "pin this" UI to show what's running NOW,
// before a pin has any historical data. Returns top-N by RSS.

const TOP_N = 80;
const PAGE_SIZE_BYTES = 4096n;

interface LiveProcess {
  pid: number;
  comm: string;
  rssBytes: string;     // bigint as string for JSON safety
  threads: number;
  utimeJiffies: string;
  stimeJiffies: string;
  starttimeJiffies: string;
}

function parseStat(raw: string): { comm: string; utime: bigint; stime: bigint; rssPages: bigint; threads: number; starttime: bigint } | null {
  const close = raw.lastIndexOf(')');
  const open = raw.indexOf('(');
  if (close < 0 || open < 0 || open > close) return null;
  const comm = raw.slice(open + 1, close);
  const tail = raw.slice(close + 2).trim().split(/\s+/);
  if (tail.length < 22) return null;
  return {
    comm,
    utime: BigInt(tail[11]),
    stime: BigInt(tail[12]),
    threads: parseInt(tail[17]),
    starttime: BigInt(tail[19]),
    rssPages: BigInt(tail[21]),
  };
}

export async function GET() {
  try {
    const entries = await fs.readdir('/proc');
    const out: LiveProcess[] = [];
    await Promise.all(entries.map(async (name) => {
      if (!/^\d+$/.test(name)) return;
      try {
        const raw = await fs.readFile(`/proc/${name}/stat`, 'utf-8');
        const parsed = parseStat(raw);
        if (!parsed || parsed.rssPages === 0n) return;
        out.push({
          pid: parseInt(name),
          comm: parsed.comm,
          rssBytes: (parsed.rssPages * PAGE_SIZE_BYTES).toString(),
          threads: parsed.threads,
          utimeJiffies: parsed.utime.toString(),
          stimeJiffies: parsed.stime.toString(),
          starttimeJiffies: parsed.starttime.toString(),
        });
      } catch { /* exited mid-read */ }
    }));
    out.sort((a, b) => {
      const da = BigInt(a.rssBytes); const db = BigInt(b.rssBytes);
      return da > db ? -1 : da < db ? 1 : 0;
    });
    return NextResponse.json({
      processes: out.slice(0, TOP_N),
      coreCount: os.cpus().length,
      clockTicks: 100,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
