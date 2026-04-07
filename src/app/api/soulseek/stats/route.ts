import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [
      downloadSummary,
      uploadSummary,
      topDownloadSources,
      topUploadUsers,
      dailyDownloads,
      dailyUploads,
      recentDownloads,
      recentUploads,
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
        GROUP BY username ORDER BY count DESC LIMIT 10
      `),
      pool.query(`
        SELECT username, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_bytes
        FROM soulseek_uploads WHERE status = 'completed'
        GROUP BY username ORDER BY count DESC LIMIT 10
      `),
      pool.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM soulseek_downloads
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at) ORDER BY date
      `),
      pool.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM soulseek_uploads
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at) ORDER BY date
      `),
      pool.query(`
        SELECT * FROM soulseek_downloads ORDER BY created_at DESC LIMIT 10
      `),
      pool.query(`
        SELECT * FROM soulseek_uploads ORDER BY created_at DESC LIMIT 10
      `),
    ]);

    return NextResponse.json({
      downloads: {
        summary: downloadSummary.rows[0],
        topSources: topDownloadSources.rows,
        daily: dailyDownloads.rows,
        recent: recentDownloads.rows,
      },
      uploads: {
        summary: uploadSummary.rows[0],
        topUsers: topUploadUsers.rows,
        daily: dailyUploads.rows,
        recent: recentUploads.rows,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch stats', detail: String(error) }, { status: 500 });
  }
}
