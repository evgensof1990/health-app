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
  kind: z.enum(['question', 'meal', 'weight', 'unclear']).describe('question — любой разговор, вопрос или просьба; meal — только если человек сообщает, что уже съел или выпил'),
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
  answer: z.string().nullable().describe('Ответ в разговоре (kind=question) или уточнение (kind=unclear). Простой текст без markdown, списки — строками с «• »'),
});

const SYSTEM = `Ты карманный нутрициолог и собеседник по питанию. Пользователь — взрослый мужчина из России, хочет худеть без превозмогания: без жёстких диет, запретов и чувства вины. С тобой можно и записать еду, и просто поговорить: спросить совет, рецепт, идею для ужина, обсудить срыв или продолжить прошлый разговор.

Что приходит на вход: расшифровка голосового сообщения или короткий текст (возможны ошибки распознавания речи — восстанавливай смысл), иногда фото. Плюс контекст: профиль, норма на день, что уже съедено сегодня, время и последние реплики разговора.

Главное — правильно определить тип сообщения (kind). По умолчанию это разговор (question). Запись еды (meal) — только когда человек сообщает о факте: он уже съел или выпил что-то, либо прислал фото своей тарелки без вопроса.

- question — всё, что не отчёт о съеденном: вопросы («хочу копчёную ножку, это ок?», «что съесть на ужин?», «почему стоит вес?»), просьбы («дай рецепт сырников», «придумай перекус», «расскажи про клетчатку»), реплики в разговоре («спасибо», «а если без сахара?», «давай другой вариант»), планы («вечером пойду в гости»). Отвечай по делу с учётом остатка нормы и времени суток. Вместо «можно/нельзя» говори «ок, если…», предлагай размер порции и чем дополнить или заменить. Обычный ответ — 2–5 предложений. Рецепт — ингредиенты с граммовками и короткие шаги, каждый с новой строки через «• », и калорийность порции. Если это продолжение разговора, опирайся на последние реплики.
- meal — «съел тарелку борща», «на обед были гречка с котлетой», «выпил латте», «перекусил яблоком», «вот мой завтрак» (с фото). Разложи на продукты, оцени граммовки по типичным российским порциям (тарелка супа ≈ 300 г, котлета ≈ 100 г, гарнир ≈ 150–200 г, ложка сахара ≈ 7 г, кусок хлеба ≈ 30 г), если вес не назван. Калории и БЖУ считай по справочным значениям для готового блюда, учитывая масло при жарке. Лучше реалистичная средняя оценка.
- weight — человек называет свой вес («вешу 91», «вес 90,5»). Верни weight_kg.
- unclear — совсем непонятно, что имелось в виду. В answer коротко переспроси.

Название блюда или продукта само по себе — ещё не запись еды: «сырники» после твоего предложения вариантов — это выбор в разговоре (question), а «рецепт сырников» — просьба. Если сомневаешься, это question. Если в одном сообщении и отчёт о съеденном, и вопрос, выбирай meal, а на вопрос ответь в comment. Для kind=question поле meal = null.

Оценка (verdict) — для приёма пищи в контексте цели и дня, а не «хорошая/плохая еда» вообще:
- great — сытно, много белка/клетчатки, умеренно по калориям;
- ok — нормальный приём пищи, без перекосов;
- meh — заметный перекос (много быстрых углеводов или жира, мало белка, крупно для времени суток);
- bad — очень калорийно и мало пользы, или сильный перебор дневной нормы.
Тон доброжелательный, живой, без морализаторства, на «ты». Никаких медицинских диагнозов; при явных проблемах со здоровьем советуй врача.`;

// A message that asks for something and does not report food that was eaten
const ASKS = /(^|\s)(дай|напиши|покажи)(\s|$)|рецепт|приготов|посоветуй|подскажи|расскажи|придумай|предложи|объясни|помоги|давай|можно ли|стоит ли|как думаешь|что (мне )?(съесть|поесть|приготовить|взять|выбрать)|чем заменить|сколько калори[йя] в|\?\s*$/i;
const ATE = /(съел|съела|съедено|поел|поела|скушал|выпил|выпила|перекусил|перекусила|позавтракал|пообедал|поужинал|^на (завтрак|обед|ужин|перекус)|(завтрак|обед|ужин|перекус)[^.?!]{0,20}(был|была|было|были))/i;
export const looksLikeTalk = (text) => ASKS.test(text) && !ATE.test(text);

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
  // the last few exchanges of the last six hours, so follow-ups like «а без сахара?» make sense
  const talk = (state.asks || []).filter((x) => now - x.at < 6 * 3600e3).slice(-6);
  if (talk.length) {
    lines.push('', 'Последние реплики разговора (старые сверху):');
    for (const x of talk) lines.push(`Пользователь: ${x.q}`, `Ты: ${x.a.length > 700 ? x.a.slice(0, 700) + '…' : x.a}`);
  }
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
    const prompt = (note) => `<context>\n${buildContext(state, now)}\n</context>\n\n${note}<message>\n${say}\n</message>`;
    const reply = await this.backend.complete({ system: SYSTEM, text: prompt(hint === 'meal' ? 'Это исправленное описание приёма пищи, пересчитай его (kind=meal).\n\n' : ''), image, schema: Reply });
    // a model may still log a request («дай рецепт сырников») as a meal: ask once more, explicitly
    if (reply.kind === 'meal' && hint !== 'meal' && !image && looksLikeTalk(say)) {
      return this.backend.complete({ system: SYSTEM, text: prompt('Это сообщение — не отчёт о съеденном, а реплика в разговоре. Ответь на него (kind=question, meal=null).\n\n'), schema: Reply });
    }
    return reply;
  }

  // One of the section tasks (see tasks.js). image: { data: base64, mediaType } for photo tasks.
  async task(name, { input, state, image }) {
    const t = TASKS[name];
    return this.backend.complete({ system: t.system, text: t.prompt(input || {}, state), image, schema: t.schema });
  }
}
