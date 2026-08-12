/**
 * Worker wrapper around the chunk mesher.
 *
 * Meshing the current colony is ~330k solid blocks of face culling. On the main
 * thread that is a visible stall with the camera frozen; here each chunk lands
 * and appears on its own, so the village builds up progressively while the view
 * stays interactive.
 *
 * The atlas is sent once at init rather than with every chunk — it is a 558 KB
 * object and structured-cloning it 81 times would cost more than the meshing.
 */
import { meshChunk, type AtlasData, type ChunkPayload, type MeshResult } from './mesher';

let atlas: AtlasData | null = null;

type InitMessage = { type: 'init'; atlas: AtlasData };
type MeshMessage = { type: 'mesh'; chunk: ChunkPayload };

self.onmessage = (event: MessageEvent<InitMessage | MeshMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    atlas = message.atlas;
    (self as unknown as Worker).postMessage({ type: 'ready' });
    return;
  }

  if (!atlas) {
    (self as unknown as Worker).postMessage({ type: 'error', error: 'mesh requested before init' });
    return;
  }

  const result: MeshResult = meshChunk(atlas, message.chunk);
  // Transfer the buffers rather than copying them: a busy chunk is a few MB of
  // vertex data and it is used exactly once, on the other side.
  (self as unknown as Worker).postMessage({ type: 'mesh', result }, [
    result.position.buffer,
    result.uv.buffer,
    result.color.buffer,
    result.index.buffer,
  ]);
};
