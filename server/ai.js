// Claude as a pocket nutritionist: one call understands what was said (a meal, a question,
// a weigh-in) and returns structured data. Requests go through a Cloudflare Worker
// (deploy/ai-proxy-worker.js), because api.anthropic.com is not reachable from Russia;
// the worker swaps our shared secret for the real API key.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { dayKey, mealsOn, totals, shiftDay } from '../shared/nutrition.js';

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.AI_EFFORT || 'medium';

const Item = z.object({
  name: z.string().describe('Продукт или блюдо по-русски, коротко'),
  grams: z.number().describe('Оценка веса порции в граммах (для напитков — мл)'),
  kcal: z.number(),
  protein: z.number().describe('Белки, г'),
  fat: z.number().describe('Жиры, г'),
  carbs: z.number().describe('Углеводы, г'),
});

export const Reply = z.object({
  kind: z.enum(['meal', 'question', 'weight', 'unclear']),
  meal: z
    .object({
      title: z.string().describe('Короткое название приёма пищи, 2–5 слов'),
      eaten_minutes_ago: z.number().nullable().describe('Если человек сказал, что ел раньше («на завтрак», «час назад»), сколько минут назад; иначе null'),
      items: z.array(Item),
      verdict: z.enum(['great', 'ok', 'meh', 'bad']),
      comment: z.string().describe('1–2 предложения: чем хороша или плоха еда с учётом цели и съеденного за день'),
      tip: z.string().nullable().describe('Один конкретный совет на следующий приём пищи или null'),
    })
    .nullable(),
  weight_kg: z.number().nullable(),
  answer: z.string().nullable().describe('Ответ на вопрос (kind=question) или уточнение (kind=unclear). Простой текст без markdown'),
});

const SYSTEM = `Ты карманный нутрициолог и помощник по снижению веса. Пользователь — взрослый мужчина из России, хочет худеть без превозмогания: без жёстких диет, запретов и чувства вины. Твоя задача — быстро и честно оценивать еду и давать практичные советы.

Что приходит на вход: расшифровка голосового сообщения или короткий текст (возможны ошибки распознавания речи — восстанавливай смысл), иногда фото еды. Плюс контекст: профиль, норма на день, что уже съедено сегодня, время.

Определи тип сообщения:
- meal — человек сообщает, что съел или выпил. Разложи на продукты, оцени граммовки по типичным российским порциям (тарелка супа ≈ 300 г, котлета ≈ 100 г, гарнир ≈ 150–200 г, ложка сахара ≈ 7 г, кусок хлеба ≈ 30 г), если вес не назван. Калории и БЖУ считай по справочным значениям для готового блюда, учитывая масло при жарке. Не занижай и не завышай: лучше реалистичная средняя оценка.
- question — вопрос вида «хочу копчёную ножку, это ок?», «что съесть на ужин?», «почему стоит вес?». Отвечай конкретно с учётом остатка нормы на сегодня и времени суток: можно/нельзя не говори, говори «ок, если…», предлагай размер порции и чем дополнить или заменить. 2–5 предложений.
- weight — человек называет свой вес. Верни weight_kg.
- unclear — непонятно, что имелось в виду. В answer коротко переспроси.
Если в одном сообщении и еда, и вопрос, выбирай meal, а на вопрос ответь в comment.

Оценка (verdict) — для приёма пищи в контексте цели и дня, а не «хорошая/плохая еда» вообще:
- great — сытно, много белка/клетчатки, умеренно по калориям;
- ok — нормальный приём пищи, без перекосов;
- meh — заметный перекос (много быстрых углеводов или жира, мало белка, крупно для времени суток);
- bad — очень калорийно и мало пользы, или сильный перебор дневной нормы.
Тон доброжелательный, без морализаторства, на «ты». Никаких медицинских диагнозов; при явных проблемах со здоровьем советуй врача.`;

export function buildContext(state, now = Date.now()) {
  const today = dayKey(now);
  const eaten = mealsOn(state.meals, today);
  const t = totals(eaten);
  const p = state.profile;
  const target = p?.targets;
  const lines = [];
  lines.push(`Сейчас: ${new Date(now).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`);
  if (p) {
    lines.push(`Профиль: ${p.sex === 'f' ? 'женщина' : 'мужчина'}, ${p.age} лет, рост ${p.height} см, вес ${p.weight} кг${p.goalWeight ? `, цель ${p.goalWeight} кг` : ''}.${p.notes ? ' Особенности: ' + p.notes : ''}`);
  }
  if (target) lines.push(`Норма на день: ${target.kcal} ккал, белки ${target.protein} г, жиры ${target.fat} г, углеводы ${target.carbs} г.`);
  if (eaten.length) {
    lines.push('Уже съедено сегодня:');
    for (const m of eaten) lines.push(`- ${new Date(m.at).toTimeString().slice(0, 5)} ${m.title}: ${m.kcal} ккал (Б${m.protein}/Ж${m.fat}/У${m.carbs})`);
    lines.push(`Итого: ${t.kcal} ккал, Б${t.protein}/Ж${t.fat}/У${t.carbs}.${target ? ` Остаток: ${target.kcal - t.kcal} ккал.` : ''}`);
  } else lines.push('Сегодня ещё ничего не записано.');
  const week = [];
  for (let i = 1; i <= 7; i++) {
    const ms = mealsOn(state.meals, shiftDay(today, -i));
    if (ms.length) week.push(totals(ms).kcal);
  }
  if (week.length >= 3) lines.push(`В среднем за прошлые ${week.length} дн. с записями: ${Math.round(week.reduce((a, b) => a + b, 0) / week.length)} ккал в день.`);
  const w = state.weights.slice(-3);
  if (w.length) lines.push('Последние взвешивания: ' + w.map((x) => `${x.date} — ${x.kg} кг`).join(', ') + '.');
  return lines.join('\n');
}

export class Nutritionist {
  constructor({ apiKey, baseURL }) {
    this.client = new Anthropic({ apiKey, baseURL: baseURL || undefined, maxRetries: 2, timeout: 90_000 });
  }

  // text: what the user said; image: { data: base64, mediaType } | null; hint: 'meal' to force a meal
  async interpret({ text, image, hint, state, now = Date.now() }) {
    const content = [];
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType || 'image/jpeg', data: image.data } });
    const say = text?.trim() || (image ? 'Вот что я ем (фото).' : '');
    content.push({
      type: 'text',
      text: `<context>\n${buildContext(state, now)}\n</context>\n\n${hint === 'meal' ? 'Это исправленное описание приёма пищи, пересчитай его (kind=meal).\n\n' : ''}<message>\n${say}\n</message>`,
    });
    const res = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT, format: betaZodOutputFormat(Reply) },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') throw Object.assign(new Error('ИИ отказался отвечать на это сообщение. Попробуй переформулировать.'), { status: 422 });
    if (res.stop_reason === 'max_tokens' || !res.parsed_output) throw Object.assign(new Error('ИИ ответил неполностью, попробуй ещё раз'), { status: 502 });
    return res.parsed_output;
  }
}
