import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Daily traffic counts only what actually moved (completed), so the charts
// and the summary tiles tell the same story.
const DAILY = (table: string) => `
  SELECT to_char(DATE(created_at), 'YYYY-MM-DD') AS date,
         COUNT(*) AS count,
         COALESCE(SUM(size_bytes), 0) AS bytes
  FROM ${table}
  WHERE created_at > NOW() - INTERVAL '90 days' AND status = 'completed'
  GROUP BY DATE(created_at) ORDER BY 1
`;

export async function GET() {
  try {
    const [
      downloadSummary,
      uploadSummary,
      topDownloadSources,
      topUploadUsers,
      dailyDownloads,
      dailyUploads,
      hourlyUploads,
      topRecords,
      formats,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'staging') as staging,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COALESCE(SUM(size_bytes) FILTER (WHERE status = 'completed'), 0) as total_bytes,
          COALESCE(AVG(speed_bytes_per_sec) FILTER (WHERE speed_bytes_per_sec > 0), 0) as avg_speed,
          COUNT(DISTINCT username) as unique_sources
        FROM soulseek_downloads
      `),
      pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COALESCE(SUM(size_bytes) FILTER (WHERE status = 'completed'), 0) as total_bytes,
          COALESCE(AVG(speed_bytes_per_sec) FILTER (WHERE speed_bytes_per_sec > 0), 0) as avg_speed,
          COUNT(DISTINCT username) as unique_users
        FROM soulseek_uploads
      `),
      pool.query(`
        SELECT username, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_bytes
        FROM soulseek_downloads WHERE status = 'completed'
        GROUP BY username ORDER BY SUM(size_bytes) DESC NULLS LAST LIMIT 10
      `),
      pool.query(`
        SELECT username, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_bytes,
               MAX(created_at) as last_at
        FROM soulseek_uploads WHERE status = 'completed'
        GROUP BY username ORDER BY SUM(size_bytes) DESC NULLS LAST LIMIT 10
      `),
      pool.query(DAILY('soulseek_downloads')),
      pool.query(DAILY('soulseek_uploads')),
      pool.query(`
        SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*) AS count
        FROM soulseek_uploads WHERE status = 'completed'
        GROUP BY 1 ORDER BY 1
      `),
      pool.query(`
        SELECT artist, album, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_bytes
        FROM soulseek_uploads WHERE status = 'completed' AND artist IS NOT NULL
        GROUP BY artist, album ORDER BY count DESC, SUM(size_bytes) DESC LIMIT 8
      `),
      pool.query(`
        SELECT LOWER(SUBSTRING(filename FROM '\\.([A-Za-z0-9]+)$')) AS ext,
               COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as bytes
        FROM soulseek_uploads WHERE status = 'completed'
        GROUP BY 1 ORDER BY count DESC
      `),
    ]);

    return NextResponse.json({
      downloads: {
        summary: downloadSummary.rows[0],
        topSources: topDownloadSources.rows,
        daily: dailyDownloads.rows,
      },
      uploads: {
        summary: uploadSummary.rows[0],
        topUsers: topUploadUsers.rows,
        daily: dailyUploads.rows,
        hourly: hourlyUploads.rows,
        topRecords: topRecords.rows,
        formats: formats.rows,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch stats', detail: String(error) }, { status: 500 });
  }
}
