import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

const MIME_TYPES: Record<string, string> = {
	'.mp3': 'audio/mpeg',
	'.flac': 'audio/flac',
	'.wav': 'audio/wav',
	'.m4a': 'audio/mp4',
	'.ogg': 'audio/ogg',
};

export async function GET(request: NextRequest) {
	const artist = request.nextUrl.searchParams.get('artist');
	const album = request.nextUrl.searchParams.get('album');
	const song = request.nextUrl.searchParams.get('song');

	if (!artist || !album || !song) {
		return NextResponse.json({ error: 'Missing artist, album, or song parameter' }, { status: 400 });
	}

	const config = JSON.parse(await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8'));
	let filePath = path.join(config.musicDirectory, artist, album, song);

	// Prevent path traversal
	let resolved = path.resolve(filePath);
	if (!resolved.startsWith(path.resolve(config.musicDirectory))) {
		return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
	}

	// If file doesn't exist and song has a virtual disc prefix, try stripping it
	try {
		await fs.stat(resolved);
	} catch {
		const discMatch = song.match(/^Disc \d+\/(.+)$/);
		if (discMatch) {
			const fallback = path.join(config.musicDirectory, artist, album, discMatch[1]);
			const fallbackResolved = path.resolve(fallback);
			if (fallbackResolved.startsWith(path.resolve(config.musicDirectory))) {
				resolved = fallbackResolved;
			}
		}
	}

	try {
		const stat = await fs.stat(resolved);
		const ext = path.extname(song).toLowerCase();
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		const rangeHeader = request.headers.get('range');

		if (rangeHeader) {
			const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
			if (match) {
				const start = parseInt(match[1], 10);
				const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
				const chunk = await fs.readFile(resolved);
				const sliced = chunk.slice(start, end + 1);

				return new NextResponse(new Uint8Array(sliced), {
					status: 206,
					headers: {
						'Content-Type': contentType,
						'Content-Range': `bytes ${start}-${end}/${stat.size}`,
						'Content-Length': sliced.length.toString(),
						'Accept-Ranges': 'bytes',
					},
				});
			}
		}

		const fileBuffer = await fs.readFile(resolved);
		return new NextResponse(new Uint8Array(fileBuffer), {
			headers: {
				'Content-Type': contentType,
				'Content-Length': stat.size.toString(),
				'Accept-Ranges': 'bytes',
			},
		});
	} catch {
		return NextResponse.json({ error: 'File not found' }, { status: 404 });
	}
}
