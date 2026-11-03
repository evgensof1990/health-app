// Health assistant server: stores the user's data, recognises voice (Yandex SpeechKit)
// and asks Claude to understand meals and questions. Configuration via environment variables
// (see README.md).
import { createServer } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { Nutritionist } from './ai.js';
import { applyReply, mealFromReply } from './apply.js';
import { speechKit } from './speechkit.js';
import { calcTargets, dayKey } from '../shared/nutrition.js';

process.env.TZ ||= 'Europe/Moscow';

const env = process.env;
const PORT = +(env.PORT || 3310);
const HOST = env.HOST || '127.0.0.1';
const TOKEN = env.HEALTH_TOKEN || '';
const ORIGINS = (env.ALLOWED_ORIGINS || 'https://health.myrenthub.ru,https://localhost,capacitor://localhost,http://localhost:5173').split(',').map((s) => s.trim());

if (TOKEN.length < 16) {
  console.error('HEALTH_TOKEN не задан или короче 16 символов');
  process.exit(1);
}

const store = new Store(env.DATA_DIR || './data');
const stt = env.SPEECHKIT_API_KEY ? speechKit(env.SPEECHKIT_API_KEY) : null;
const ai = env.AI_PROXY_SECRET || env.ANTHROPIC_API_KEY ? new Nutritionist({ apiKey: env.AI_PROXY_SECRET || env.ANTHROPIC_API_KEY, baseURL: env.AI_PROXY_URL }) : null;

const same = (a, b) => {
  const got = Buffer.from(a || '');
  const want = Buffer.from(b);
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
};
const authorized = (req) => same((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), TOKEN);

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Слишком большой запрос'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const readJson = async (req, limit = 8e6) => JSON.parse((await readRaw(req, limit)).toString('utf8') || '{}');
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const needAi = () => {
  if (!ai) throw bad('ИИ не настроен на сервере: нужен AI_PROXY_URL и AI_PROXY_SECRET', 409);
};

function cleanProfile(b) {
  const num = (v, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw bad('Проверь профиль: значение вне диапазона');
    return n;
  };
  const p = {
    sex: b.sex === 'f' ? 'f' : 'm',
    age: num(b.age, 14, 100),
    height: num(b.height, 120, 230),
    weight: num(b.weight, 30, 300),
    goalWeight: b.goalWeight ? num(b.goalWeight, 30, 300) : null,
    activity: ['sedentary', 'light', 'moderate', 'high'].includes(b.activity) ? b.activity : 'light',
    pace: ['keep', 'gentle', 'normal'].includes(b.pace) ? b.pace : 'gentle',
    notes: String(b.notes || '').slice(0, 500),
  };
  p.targets = calcTargets(p);
  return p;
}

const routes = [
  ['GET', /^\/api\/health$/, () => [200, { ok: true, ai: !!ai, voice: !!stt }]],
  ['GET', /^\/api\/state$/, () => [200, store.data]],

  [
    'PUT',
    /^\/api\/profile$/,
    async (req) => {
      const p = cleanProfile(await readJson(req));
      const today = dayKey();
      if (!store.data.weights.some((w) => w.date === today)) store.setWeight(today, p.weight);
      return [200, { profile: store.setProfile(p) }];
    },
  ],

  [
    'POST',
    /^\/api\/voice$/,
    async (req, url) => {
      if (!stt) throw bad('Распознавание голоса не настроено на сервере (SPEECHKIT_API_KEY)', 409);
      const audio = await readRaw(req, 1e6);
      return [200, { text: await stt(audio, url.searchParams.get('format') || 'lpcm') }];
    },
  ],

  // Main entry: a meal, a question or a weigh-in, as text and/or a photo
  [
    'POST',
    /^\/api\/input$/,
    async (req) => {
      needAi();
      const b = await readJson(req);
      const text = String(b.text || '').trim().slice(0, 2000);
      const image = b.image?.data ? { data: String(b.image.data), mediaType: b.image.mediaType || 'image/jpeg' } : null;
      if (!text && !image) throw bad('Пустое сообщение');
      const now = Date.now();
      const reply = await ai.interpret({ text, image, state: store.data, now });
      return [200, applyReply(store, reply, { text, source: b.source || 'app', at: Number.isFinite(b.at) ? b.at : null, now })];
    },
  ],

  [
    'PATCH',
    /^\/api\/meals\/([\w-]+)$/,
    async (req, url, [id]) => {
      const meal = store.data.meals.find((m) => m.id === id);
      if (!meal) throw bad('Запись не найдена', 404);
      const b = await readJson(req);
      const patch = {};
      if (Number.isFinite(b.at)) patch.at = b.at;
      if (typeof b.text === 'string' && b.text.trim() && b.text.trim() !== meal.text) {
        needAi();
        const reply = await ai.interpret({ text: b.text.trim(), hint: 'meal', state: { ...store.data, meals: store.data.meals.filter((m) => m.id !== id) }, now: patch.at || meal.at });
        if (!reply.meal) throw bad(reply.answer || 'Не получилось пересчитать', 422);
        Object.assign(patch, mealFromReply(reply.meal, { text: b.text.trim(), source: meal.source, at: patch.at || meal.at }));
      }
      return [200, { meal: store.updateMeal(id, patch) }];
    },
  ],
  [
    'DELETE',
    /^\/api\/meals\/([\w-]+)$/,
    (req, url, [id]) => {
      if (!store.deleteMeal(id)) throw bad('Запись не найдена', 404);
      return [200, { ok: true }];
    },
  ],

  [
    'POST',
    /^\/api\/weights$/,
    async (req) => {
      const b = await readJson(req);
      const kg = Number(b.kg);
      if (!(kg > 30 && kg < 300)) throw bad('Вес должен быть от 30 до 300 кг');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : dayKey();
      return [200, { weight: store.setWeight(date, Math.round(kg * 10) / 10) }];
    },
  ],
  [
    'DELETE',
    /^\/api\/weights\/([\w-]+)$/,
    (req, url, [id]) => {
      store.deleteWeight(id);
      return [200, { ok: true }];
    },
  ],
];

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, 'http://x');
  let hit = null;
  for (const [method, re, fn] of routes) {
    const m = method === req.method && url.pathname.match(re);
    if (m) {
      hit = [fn, m.slice(1)];
      break;
    }
  }
  if (!hit) return send(res, 404, { error: 'Не найдено' });
  if (url.pathname !== '/api/health' && !authorized(req)) return send(res, 401, { error: 'Нужен ключ доступа' });
  try {
    const [status, body] = await hit[0](req, url, hit[1]);
    send(res, status, body);
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionError) return send(res, 502, { error: 'Нет связи с ИИ, попробуй ещё раз' });
    if (e instanceof Anthropic.RateLimitError) return send(res, 503, { error: 'ИИ перегружен, попробуй через минуту' });
    if (e instanceof Anthropic.AuthenticationError) return send(res, 502, { error: 'Сервер не смог авторизоваться в ИИ: проверь ключ в воркере' });
    if (e instanceof Anthropic.APIError) {
      console.error('Claude API', e.status, e.message);
      return send(res, 502, { error: 'ИИ вернул ошибку ' + e.status });
    }
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : 'Ошибка сервера' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Помощник слушает http://${HOST}:${PORT}; ИИ ${ai ? 'подключён' : 'не настроен'}, голос ${stt ? 'включён' : 'выключен'}`);
});
