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
    env: { PATH: process.env.PATH, TZ: 'Europe/Moscow', PORT: String(PORT), HEALTH_TOKEN: TOKEN, DATA_DIR: mkdtempSync(join(tmpdir(), 'health-')), YANDEX_API_KEY: 'test-yandex-key', YANDEX_FOLDER_ID: 'b1gtestfolder', YANDEX_AI_URL: fake.url + '/v1' },
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
  assert.equal(req.body.model, 'gpt://b1gtestfolder/aliceai-llm');
  assert.equal(req.headers['openai-project'], 'b1gtestfolder');
  assert.match(req.system, /JSON-схеме/);
  assert.match(req.prompt, /Норма на день/);
});

test('"на завтрак" moves the meal back in time', async () => {
  const [, r] = await call('POST', '/api/input', { text: 'на завтрак съел гречку' });
  assert.ok(Date.now() - r.meal.at > 170 * 6e4);
});

test('a question is answered and kept', async () => {
  const [, r] = await call('POST', '/api/input', { text: 'хочу съесть копчёную куриную ножку, это ок?' });
  assert.equal(r.kind, 'question');
  assert.match(r.ask.a, /ножку/);
  const ctx = fake.calls.at(-1).prompt;
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

test('sections are saved whole and filled with defaults', async () => {
  const [s, r] = await call('PUT', '/api/sections/growth', { books: [{ id: 'b1', title: 'Марсианин', author: 'Энди Вейер', status: 'reading' }] });
  assert.equal(s, 200);
  assert.deepEqual(r.growth.wins, undefined);
  assert.deepEqual(r.growth.habitLog, {});
  const [, st] = await call('GET', '/api/state');
  assert.equal(st.sections.growth.books[0].title, 'Марсианин');
  assert.deepEqual(st.sections.self.wins, []);
  const [s2] = await call('PUT', '/api/sections/nope', {});
  assert.equal(s2, 404);
  const [s3] = await call('PUT', '/api/sections/self', [1, 2]);
  assert.equal(s3, 400);
});

test('section AI tasks get stored context', async () => {
  const [s, r] = await call('POST', '/api/ai/books', { input: { wish: 'психология' } });
  assert.equal(s, 200);
  assert.ok(r.result.books.length >= 2);
  const prompt = fake.calls.at(-1).prompt;
  assert.match(prompt, /Марсианин/);
  assert.match(prompt, /психология/);
  const [, w] = await call('POST', '/api/ai/wheel', { input: { scores: { Здоровье: 6, Работа: 8 } } });
  assert.equal(w.result.steps.length, 2);
  const [, j] = await call('POST', '/api/ai/jokeReview', { input: { situation: 'x', technique: 'y', answer: 'z' } });
  assert.equal(j.result.score, 7);
  const [s4] = await call('POST', '/api/ai/toString', {});
  assert.equal(s4, 404);
});

test('photos: upload, analyse, fetch, delete', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
  const up = await fetch(`http://127.0.0.1:${PORT}/api/photos`, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/octet-stream' }, body: jpeg });
  const { id } = await up.json();
  assert.match(id, /^[\w-]{36}$/);
  const [s, r] = await call('POST', '/api/ai/styleItem', { input: {}, photoId: id });
  assert.equal(s, 200);
  assert.ok(r.result.name);
  const last = fake.calls.at(-1);
  assert.equal(last.body.model, 'gpt://b1gtestfolder/qwen3.6-35b-a3b');
  assert.match(last.image.image_url.url, /^data:image\/jpeg;base64,/);
  const got = await fetch(`http://127.0.0.1:${PORT}/api/photos/${id}`, { headers: { Authorization: 'Bearer ' + TOKEN } });
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await got.arrayBuffer()).length, jpeg.length);
  const [s2] = await call('POST', '/api/ai/styleItem', { input: {} });
  assert.equal(s2, 400);
  await call('DELETE', '/api/photos/' + id);
  const gone = await fetch(`http://127.0.0.1:${PORT}/api/photos/${id}`, { headers: { Authorization: 'Bearer ' + TOKEN } });
  assert.equal(gone.status, 404);
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/photos/..%2F..%2Fhealth`, { headers: { Authorization: 'Bearer ' + TOKEN } });
  assert.equal(bad.status, 404);
});
