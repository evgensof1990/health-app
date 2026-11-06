import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from '../server/node_modules/zod/index.js';
import { YandexBackend, ClaudeBackend, backendFromEnv, extractJson } from '../server/backends.js';
import { Nutritionist, Reply, looksLikeTalk, buildContext } from '../server/ai.js';
import { TASKS } from '../server/tasks.js';
import { emptyState } from '../server/store.js';
import { startFakeClaude } from './fake-claude.js';

test('every schema converts to JSON Schema for the Yandex prompt', () => {
  for (const s of [Reply, ...Object.values(TASKS).map((t) => t.schema)]) {
    const js = z.toJSONSchema(s);
    assert.equal(js.type, 'object');
  }
});

test('extractJson copes with fences and chatter', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Вот ответ: {"a":{"b":2}} надеюсь помог'), { a: { b: 2 } });
  assert.throws(() => extractJson('нет json'));
});

test('Yandex backend retries once after invalid JSON', async () => {
  const fake = await startFakeClaude(0, { badJsonOnce: true });
  try {
    const ai = new Nutritionist(new YandexBackend({ apiKey: 'test-yandex-key', folder: 'f1', baseURL: fake.url + '/v1' }));
    const r = await ai.interpret({ text: 'съел гречку с котлетой', state: emptyState() });
    assert.equal(r.kind, 'meal');
    assert.equal(fake.calls.length, 2);
    assert.match(fake.calls[1].body.messages.at(-1).content, /не прошёл проверку/);
  } finally {
    fake.srv.close();
  }
});

test('Yandex backend reports a rejected key in plain words', async () => {
  const fake = await startFakeClaude(0);
  try {
    const b = new YandexBackend({ apiKey: 'wrong', folder: 'f1', baseURL: fake.url + '/v1' });
    await assert.rejects(b.complete({ system: 's', text: 't', schema: Reply }), /ai\.languageModels\.user/);
  } finally {
    fake.srv.close();
  }
});

test('Claude backend still works through the proxy', async () => {
  const fake = await startFakeClaude(0);
  try {
    const ai = new Nutritionist(new ClaudeBackend({ apiKey: 'test-proxy-secret-123', baseURL: fake.url }));
    const r = await ai.task('reframe', { input: { thought: 'я всё испортил' }, state: emptyState() });
    assert.ok(r.reframe);
    assert.equal(fake.calls[0].body.model, 'claude-opus-5-5');
    assert.equal(fake.calls[0].body.fallbacks, 'default');
  } finally {
    fake.srv.close();
  }
});

test('provider is picked from the environment', () => {
  assert.equal(backendFromEnv({}), null);
  assert.equal(backendFromEnv({ YANDEX_API_KEY: 'k', YANDEX_FOLDER_ID: 'f' }).name, 'Яндекс AI Studio');
  assert.equal(backendFromEnv({ AI_PROXY_SECRET: 's' }).name, 'Claude');
  assert.equal(backendFromEnv({ AI_PROVIDER: 'claude', YANDEX_API_KEY: 'k', YANDEX_FOLDER_ID: 'f', AI_PROXY_SECRET: 's' }).name, 'Claude');
});

test('requests are told apart from food reports', () => {
  for (const t of ['дай рецепт сырников', 'что приготовить на ужин', 'посоветуй перекус', 'а если без сахара?', 'давай другой вариант']) assert.ok(looksLikeTalk(t), t);
  for (const t of ['съел тарелку борща', 'на обед была гречка с котлетой', 'выпил латте и съел круассан, это нормально?', 'гречка с котлетой']) assert.ok(!looksLikeTalk(t), t);
});

test('a request logged as a meal is asked again as a conversation', async () => {
  const fake = await startFakeClaude(0);
  try {
    const ai = new Nutritionist(new YandexBackend({ apiKey: 'test-yandex-key', folder: 'f1', baseURL: fake.url + '/v1' }));
    const r = await ai.interpret({ text: 'дай рецепт сырников', state: emptyState() });
    assert.equal(r.kind, 'question');
    assert.match(r.answer, /творог/);
    assert.equal(fake.calls.length, 2);
  } finally {
    fake.srv.close();
  }
});

test('recent conversation goes into the context', () => {
  const now = Date.now();
  const st = { ...emptyState(), asks: [{ at: now - 8 * 3600e3, q: 'старое', a: 'x' }, { at: now - 60e3, q: 'что на ужин?', a: 'Омлет или сырники.' }] };
  const ctx = buildContext(st, now);
  assert.match(ctx, /Пользователь: что на ужин\?\nТы: Омлет или сырники\./);
  assert.ok(!ctx.includes('старое'));
});
