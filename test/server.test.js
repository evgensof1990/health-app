import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeClaude } from './fake-claude.js';

const TOKEN = 'test-token-0123456789';
const PORT = 3417;
let fake, proc;
const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return [r.status, await r.json()];
};

before(async () => {
  fake = await startFakeClaude(0);
  proc = spawn(process.execPath, ['index.js'], {
    cwd: new URL('../server/', import.meta.url),
    env: { PATH: process.env.PATH, TZ: 'Europe/Moscow', PORT: String(PORT), HEALTH_TOKEN: TOKEN, DATA_DIR: mkdtempSync(join(tmpdir(), 'health-')), AI_PROXY_URL: fake.url, AI_PROXY_SECRET: 'test-proxy-secret-123' },
    stdio: 'pipe',
  });
  await new Promise((res) => proc.stdout.once('data', res));
});
after(() => {
  proc.kill();
  fake.srv.close();
});

test('rejects requests without the key', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/state`);
  assert.equal(r.status, 401);
});

test('profile gets calorie targets and a first weigh-in', async () => {
  const [s, { profile }] = await call('PUT', '/api/profile', { sex: 'm', age: 35, height: 180, weight: 92, goalWeight: 82, activity: 'light', pace: 'gentle' });
  assert.equal(s, 200);
  assert.ok(profile.targets.kcal > 2000 && profile.targets.kcal < 2700, String(profile.targets.kcal));
  const [, st] = await call('GET', '/api/state');
  assert.equal(st.weights.length, 1);
});

test('a spoken meal becomes a stored meal with totals', async () => {
  const [s, r] = await call('POST', '/api/input', { text: 'съел гречку с котлетой и салат', source: 'voice' });
  assert.equal(s, 200);
  assert.equal(r.kind, 'meal');
  assert.equal(r.meal.kcal, 198 + 245 + 35);
  assert.equal(r.meal.verdict, 'great');
  const req = fake.calls.at(-1);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.match(req.body.messages[0].content.at(-1).text, /Норма на день/);
});

test('"на завтрак" moves the meal back in time', async () => {
  const [, r] = await call('POST', '/api/input', { text: 'на завтрак съел гречку' });
  assert.ok(Date.now() - r.meal.at > 170 * 6e4);
});

test('a question is answered and kept', async () => {
  const [, r] = await call('POST', '/api/input', { text: 'хочу съесть копчёную куриную ножку, это ок?' });
  assert.equal(r.kind, 'question');
  assert.match(r.ask.a, /ножку/);
  const ctx = fake.calls.at(-1).body.messages[0].content.at(-1).text;
  assert.match(ctx, /Уже съедено сегодня/);
});

test('a weigh-in by voice', async () => {
  const [, r] = await call('POST', '/api/input', { text: 'мой вес 91,4' });
  assert.equal(r.kind, 'weight');
  assert.equal(r.weight.kg, 91.4);
  const [, st] = await call('GET', '/api/state');
  assert.equal(st.weights.length, 1, 'same day replaces the earlier weigh-in');
  assert.equal(st.profile.weight, 91.4);
});

test('editing a meal recalculates it and delete removes it', async () => {
  const [, st] = await call('GET', '/api/state');
  const id = st.meals[0].id;
  const [s, r] = await call('PATCH', '/api/meals/' + id, { text: 'гречка 300 г и котлета' });
  assert.equal(s, 200);
  assert.equal(r.meal.text, 'гречка 300 г и котлета');
  assert.equal(r.meal.id, id);
  const [s2] = await call('DELETE', '/api/meals/' + id);
  assert.equal(s2, 200);
  const [, st2] = await call('GET', '/api/state');
  assert.ok(!st2.meals.some((m) => m.id === id));
});

test('voice without SpeechKit key says so', async () => {
  const [s, r] = await call('POST', '/api/voice', {});
  assert.equal(s, 409);
  assert.match(r.error, /SPEECHKIT/);
});
