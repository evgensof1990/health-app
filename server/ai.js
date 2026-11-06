// The pocket nutritionist and the section tasks: prompts, schemas and context.
// One call understands what was said (a meal, a question, a weigh-in) and returns structured
// data. The model itself is behind a backend (see backends.js): Yandex AI Studio by default,
// Claude as an option.
import { z } from 'zod';
import { dayKey, mealsOn, totals, shiftDay } from '../shared/nutrition.js';
import { TASKS } from './tasks.js';

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
  // backend: { complete({ system, text, image, schema }) -> parsed object }
  constructor(backend) {
    this.backend = backend;
  }

  // text: what the user said; image: { data: base64, mediaType } | null; hint: 'meal' to force a meal
  async interpret({ text, image, hint, state, now = Date.now() }) {
    const say = text?.trim() || (image ? 'Вот что я ем (фото).' : '');
    const prompt = `<context>\n${buildContext(state, now)}\n</context>\n\n${hint === 'meal' ? 'Это исправленное описание приёма пищи, пересчитай его (kind=meal).\n\n' : ''}<message>\n${say}\n</message>`;
    return this.backend.complete({ system: SYSTEM, text: prompt, image, schema: Reply });
  }

  // One of the section tasks (see tasks.js). image: { data: base64, mediaType } for photo tasks.
  async task(name, { input, state, image }) {
    const t = TASKS[name];
    return this.backend.complete({ system: t.system, text: t.prompt(input || {}, state), image, schema: t.schema });
  }
}
