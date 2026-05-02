import { NextResponse } from 'next/server';
import { getSessionStats, listTorrents } from '@/lib/transmission';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [session, torrents] = await Promise.all([
      getSessionStats(),
      listTorrents(),
    ]);

    // Top 5 most-shared torrents by bytes uploaded
    const topSeeded = [...torrents]
      .filter((t) => t.uploadedEver > 0)
      .sort((a, b) => b.uploadedEver - a.uploadedEver)
      .slice(0, 5)
      .map((t) => ({
        name: t.name,
        uploadedEver: t.uploadedEver,
        ratio: t.uploadRatio,
        secondsSeeding: t.secondsSeeding,
        isFinished: t.isFinished,
        status: t.status,
      }));

    const seedingNow = torrents.filter((t) => t.status === 5 || t.status === 6).length;

    return NextResponse.json({
      session,
      seedingNow,
      ratio: session.cumulative.downloadedBytes > 0
        ? session.cumulative.uploadedBytes / session.cumulative.downloadedBytes
        : 0,
      topSeeded,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Stats failed', detail: String(error) },
      { status: 200 },
    );
  }
}
