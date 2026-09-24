import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chatVisible,
  classifyModels,
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
