import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chatVisible,
  classifyModels,
  parlorModelLabel,
  parlorModelLists,
  parseImageProgress,
  extractGeneratedImage,
  hashPassword,
  messagesForChatModel,
  normalizeName,
  parseChatChunk,
  titleFromPrompt,
  verifyPassword,
} from './parlor';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('parlor names and passwords', () => {
  it('collapses whitespace and rejects blank or huge names', () => {
    assert.equal(normalizeName('  Ada   Lovelace '), 'Ada Lovelace');
    assert.equal(normalizeName('   '), null);
    assert.equal(normalizeName('x'.repeat(33)), null);
  });

  it('round-trips a password and rejects a wrong one', () => {
    const stored = hashPassword('lake-house');
    assert.equal(verifyPassword('lake-house', stored), true);
    assert.equal(verifyPassword('lakehouse', stored), false);
    assert.equal(verifyPassword('lake-house', 'nope'), false);
  });
});

describe('parlor visibility', () => {
  it('shows a hidden chat only to its owner', () => {
    const chat = { hidden: true, ownerId: 2 };
    assert.equal(chatVisible(chat, 2), true);
    assert.equal(chatVisible(chat, 1), false);
    assert.equal(chatVisible({ hidden: false, ownerId: 2 }, 1), true);
  });
});

describe('parlor models and transcripts', () => {
  it('splits image models by capability, and by name only when capabilities are missing', () => {
    assert.deepEqual(classifyModels([
      { name: 'gpt-oss:20b', capabilities: ['completion'] },
      { name: 'qwen-image', capabilities: ['image'] },
      { name: 'qwen2.5:7b' },
      { name: 'x/z-image-turbo' },
    ]), {
      chat: ['gpt-oss:20b', 'qwen2.5:7b'],
      image: ['qwen-image', 'x/z-image-turbo'],
    });
  });

  it('hides raw Hugging Face tags and adds Qwen Image under a short label', () => {
    assert.deepEqual(parlorModelLists([
      { name: 'laptop-qwen3:latest', capabilities: ['completion'] },
      { name: 'hf.co/unsloth/Qwen3-8B-GGUF:UD-Q4_K_XL', capabilities: ['completion'] },
      { name: 'gpt-oss:20b', capabilities: ['completion'] },
    ]), {
      chat: ['laptop-qwen3:latest', 'gpt-oss:20b'],
      image: ['qwen-image-2.1', 'z-image-turbo'],
    });
    assert.equal(parlorModelLabel('laptop-qwen3:latest'), 'Qwen3 8B');
    assert.equal(parlorModelLabel('laptop-coder:latest'), 'Coder 7B');
    assert.equal(parlorModelLabel('laptop-qwen35'), 'Qwen3.5 4B');
    assert.equal(parlorModelLabel('laptop-coder-3b'), 'Coder 3B');
    assert.equal(parlorModelLabel('laptop-gemma4'), 'Gemma 4 E2B');
    assert.equal(parlorModelLabel('qwen-image-2.1'), 'Qwen Image 2.1');
    assert.equal(parlorModelLabel('z-image-turbo'), 'Z-Image Turbo');
  });

  it('reads denoising steps and ignores tensor-load bars', () => {
    assert.deepEqual(parseImageProgress('  |==============================>                   | 12/20 - 33.91s/it\u001b[K'), {
      step: 12,
      total: 20,
      secondsPerStep: 33.91,
    });
    assert.equal(parseImageProgress('  |##################################################| 8/8 - 582.09MB/s'), null);
  });

  it('turns an image turn into a short note for the chat model', () => {
    assert.deepEqual(messagesForChatModel([
      { role: 'user', kind: 'text', content: 'draw the dock' },
      { role: 'assistant', kind: 'image', content: 'draw the dock' },
      { role: 'assistant', kind: 'text', content: '' },
      { role: 'user', kind: 'text', content: 'what color is the water?' },
    ]), [
      { role: 'user', content: 'draw the dock' },
      { role: 'assistant', content: 'Generated an image: draw the dock' },
      { role: 'user', content: 'what color is the water?' },
    ]);
  });

  it('titles a chat from the first prompt', () => {
    assert.equal(titleFromPrompt('  hello\nthere '), 'hello there');
    assert.equal(titleFromPrompt(''), 'New chat');
  });
});

describe('ollama payloads', () => {
  it('reads streamed chat tokens and a terminal error', () => {
    assert.deepEqual(parseChatChunk('{"message":{"content":"Hi","thinking":"…"},"done":false}'), {
      content: 'Hi',
      thinking: '…',
      done: false,
      error: null,
    });
    assert.equal(parseChatChunk('{"error":"model not found"}')?.error, 'model not found');
    assert.equal(parseChatChunk('not json'), null);
  });

  it('pulls a png out of an image response and surfaces a refusal', () => {
    const ok = extractGeneratedImage({ image: PNG });
    assert.equal(ok.ok, true);
    const refused = extractGeneratedImage({ error: 'image generation models are not currently supported' });
    assert.deepEqual(refused, { ok: false, error: 'image generation models are not currently supported' });
    assert.equal(extractGeneratedImage({ response: 'just words' }).ok, false);
  });
});
