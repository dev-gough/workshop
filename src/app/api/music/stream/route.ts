import fs, { promises as fsp } from 'fs';
import path from 'path';
import { Readable } from 'stream';
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

	const config = JSON.parse(await fsp.readFile(path.join(process.cwd(), 'config.json'), 'utf-8'));
	const musicDir = config.paths?.musicDirectory;
	if (!musicDir) {
		return NextResponse.json({ error: 'paths.musicDirectory is not configured' }, { status: 500 });
	}
	const filePath = path.join(musicDir, artist, album, song);

	// Prevent path traversal
	let resolved = path.resolve(filePath);
	if (!resolved.startsWith(path.resolve(musicDir))) {
		return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
	}

	// If file doesn't exist and song has a virtual disc prefix, try stripping it
	try {
		await fsp.stat(resolved);
	} catch {
		const discMatch = song.match(/^Disc \d+\/(.+)$/);
		if (discMatch) {
			const fallback = path.join(musicDir, artist, album, discMatch[1]);
			const fallbackResolved = path.resolve(fallback);
			if (fallbackResolved.startsWith(path.resolve(musicDir))) {
				resolved = fallbackResolved;
			}
		}
	}

	let stat;
	try {
		stat = await fsp.stat(resolved);
	} catch {
		return NextResponse.json({ error: 'File not found' }, { status: 404 });
	}

	const ext = path.extname(song).toLowerCase();
	const contentType = MIME_TYPES[ext] || 'application/octet-stream';
	const size = stat.size;

	// Convert a Node read stream into a web ReadableStream, destroying the
	// underlying stream if the client aborts the request.
	const toWebStream = (start: number, end: number): ReadableStream => {
		const nodeStream = fs.createReadStream(resolved, { start, end });
		const abort = () => nodeStream.destroy();
		if (request.signal.aborted) {
			nodeStream.destroy();
		} else {
			request.signal.addEventListener('abort', abort, { once: true });
			nodeStream.once('close', () => request.signal.removeEventListener('abort', abort));
		}
		return Readable.toWeb(nodeStream) as ReadableStream;
	};

	const rangeHeader = request.headers.get('range');

	if (rangeHeader) {
		const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
		// Malformed range header → fall through to a full 200 response.
		if (match && (match[1] || match[2])) {
			let start: number;
			let end: number;
			if (match[1]) {
				// bytes=start- or bytes=start-end
				start = parseInt(match[1], 10);
				end = match[2] ? parseInt(match[2], 10) : size - 1;
			} else {
				// bytes=-suffix (last N bytes)
				const suffix = parseInt(match[2], 10);
				start = Math.max(size - suffix, 0);
				end = size - 1;
			}

			// Unsatisfiable range.
			if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
				return new NextResponse(null, {
					status: 416,
					headers: {
						'Content-Range': `bytes */${size}`,
						'Accept-Ranges': 'bytes',
					},
				});
			}

			// Clamp end to the last byte.
			if (end >= size) end = size - 1;

			return new NextResponse(toWebStream(start, end), {
				status: 206,
				headers: {
					'Content-Type': contentType,
					'Content-Range': `bytes ${start}-${end}/${size}`,
					'Content-Length': (end - start + 1).toString(),
					'Accept-Ranges': 'bytes',
				},
			});
		}
	}

	return new NextResponse(size > 0 ? toWebStream(0, size - 1) : new Uint8Array(0), {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Content-Length': size.toString(),
			'Accept-Ranges': 'bytes',
		},
	});
}
