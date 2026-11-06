// Minimal stand-in for the Claude API (and the Cloudflare proxy) used by tests and local UI checks.
// Picks a canned structured reply from keywords in the user's message.
import { createServer } from 'node:http';

export function cannedReply(text) {
  if (/\?|ок|можно|стоит/i.test(text) && !/съел|ел |выпил/i.test(text)) {
    return { kind: 'question', meal: null, weight_kg: null, answer: 'Ок, если возьмёшь одну ножку без кожи (≈250 ккал) и добавишь овощи. Копчёное солёное, так что вечером выпей воды побольше.' };
  }
  const w = text.match(/вес[^\d]*(\d+[.,]?\d*)/i);
  if (w) return { kind: 'weight', meal: null, weight_kg: Number(w[1].replace(',', '.')), answer: null };
  return {
    kind: 'meal',
    meal: {
      title: 'Гречка с котлетой',
      eaten_minutes_ago: /завтрак/i.test(text) ? 180 : null,
      items: [
        { name: 'Гречка отварная', grams: 180, kcal: 198, protein: 7.6, fat: 2, carbs: 38 },
        { name: 'Котлета куриная жареная', grams: 110, kcal: 245, protein: 19, fat: 15.4, carbs: 8 },
        { name: 'Салат из огурцов и помидоров', grams: 150, kcal: 35, protein: 1.5, fat: 0.3, carbs: 6 },
      ],
      verdict: 'great',
      comment: 'Сытный обед: белок, сложные углеводы и овощи. С нормой на день всё хорошо.',
      tip: 'На ужин можно что-то полегче: творог или омлет с овощами.',
    },
    weight_kg: null,
    answer: null,
  };
}

let itemN = 0;
const ITEMS = [
  { name: 'Тёмно-синий пиджак', category: 'outer', color: 'тёмно-синий', season: ['межсезонье'], formality: 'смарт-кэжуал', verdict: 'keep', note: 'Хорошо сидит по плечам. Носи с белой рубашкой или серой водолазкой и тёмными джинсами.' },
  { name: 'Белая оксфорд-рубашка', category: 'top', color: 'белый', season: ['лето', 'межсезонье'], formality: 'смарт-кэжуал', verdict: 'keep', note: 'База гардероба. Подходит и к пиджаку, и к чиносам на выходных.' },
  { name: 'Тёмные прямые джинсы', category: 'bottom', color: 'индиго', season: ['межсезонье', 'зима'], formality: 'повседневное', verdict: 'keep', note: 'Правильная посадка и длина. Держи их тёмными: не стирай слишком часто.' },
  { name: 'Мешковатая толстовка с принтом', category: 'top', color: 'серый меланж', season: ['межсезонье'], formality: 'спорт', verdict: 'replace', note: 'Размер велик и полнит, принт выглядит по-студенчески. Замени на однотонный свитшот по фигуре.' },
  { name: 'Белые кожаные кеды', category: 'shoes', color: 'белый', season: ['лето', 'межсезонье'], formality: 'повседневное', verdict: 'ok', note: 'Подошва пожелтела: почисти, и будут как новые. Отлично идут к джинсам и чиносам.' },
];

export function taskReply(system, text) {
  if (system.includes('книжный советчик'))
    return { books: [
      { title: 'Думай медленно… решай быстро', author: 'Даниэль Канеман', pages: 650, why: 'Раз интересна психология: лучшая книга о том, как мозг нас обманывает.', start: 'По одной главе в день, они короткие.' },
      { title: 'Психология влияния', author: 'Роберт Чалдини', pages: 330, why: 'Живые примеры, читается как детектив.', start: 'Начни с главы про взаимный обмен.' },
    ] };
  if (system.includes('колесо баланса'))
    return { summary: 'Работа и деньги держатся крепко, а отдых и друзья проседают: похоже, неделя уходит в дела. Здоровье подросло с прошлого раза, это заметно.', steps: [
      { area: 'Отдых и хобби', action: 'Запланируй в субботу два часа на то, что нравится, и поставь это в календарь как встречу.' },
      { area: 'Друзья', action: 'Напиши двум друзьям и договорись о встрече на следующей неделе.' },
    ] };
  if (system.includes('когнитивно-поведенческой'))
    return { distortion: 'Чтение мыслей: ты решил за коллег, что они подумали, хотя никто ничего не сказал.', reframe: 'Ты запнулся на одном слайде из двадцати. Большинство людей этого даже не заметили: они думали о своих задачах. Отчёт ты сделал, и цифры в нём верные — это и было главное.', action: 'Спроси одного коллегу, что ему показалось самым полезным в докладе.' };
  if (system.includes('Дай одно короткое упражнение'))
    return { situation: 'Коллега заходит в переговорку, видит тебя с третьей чашкой кофе и говорит: «Ты что, на кофе живёшь?»', technique: 'преувеличение', hint: 'Согласись и доведи до абсурда: как будто кофе — это твой источник питания и энергии.' };
  if (system.includes('Оцени ответ пользователя'))
    return { score: 7, works: 'Хорошее согласие с подколом: ты не оправдываешься, а подыгрываешь.', improve: 'Сделай концовку конкретнее: точная деталь смешнее общей фразы.', variants: ['«Нет, кофе живёт на мне: я просто транспорт».', '«Это не третья чашка, это одна большая чашка в трёх частях».', '«Врачи сказали: меньше стресса. Я выбрал меньше сна».'] };
  if (system.includes('личный гайд по стилю'))
    return { summary: 'Собранный смарт-кэжуал: спокойные цвета, хорошая посадка, минимум логотипов. Выглядишь уверенно и современно, но без офисной скуки.', colors: ['тёмно-синий', 'графитовый', 'белый', 'песочный', 'оливковый', 'бордовый как акцент'], avoid: ['Мешковатые худи и футболки с крупными принтами', 'Джинсы с потёртостями и низкой посадкой', 'Острые носы у туфель', 'Яркие кроссовки к пиджаку'], capsule: [
      { item: 'Тёмно-синий неконструированный пиджак', why: 'Делает собранным любой образ, от джинсов до чинос', priority: 1 },
      { item: 'Две белые и одна голубая оксфорд-рубашки', why: 'База под пиджак и отдельно', priority: 1 },
      { item: 'Тёмные прямые джинсы без потёртостей', why: 'Основа на каждый день', priority: 1 },
      { item: 'Бежевые чиносы', why: 'Альтернатива джинсам для встреч', priority: 2 },
      { item: 'Серая водолазка из мериноса', why: 'Тепло и стильно под пиджак зимой', priority: 2 },
      { item: 'Коричневые замшевые челси', why: 'Универсальная обувь на межсезонье', priority: 2 },
      { item: 'Тёмно-синее пальто до середины бедра', why: 'Верхняя одежда к любому образу', priority: 3 },
    ], rules: ['Брюки — без заломов над обувью или с одним небольшим', 'Шов плеча пиджака — ровно на краю плеча', 'Ремень по цвету обуви', 'Не больше трёх цветов в образе', 'Футболки — плотные, однотонные, по фигуре'] };
  if (system.includes('вещь из гардероба')) return ITEMS[itemN++ % ITEMS.length];
  if (system.includes('Собери 1–2 образа')) {
    const ids = [...text.matchAll(/^([\w]+): /gm)].map((m) => m[1]);
    return { looks: [{ title: 'Собранно, но без галстука', itemIds: ids.slice(0, 3), why: 'Пиджак с белой рубашкой задаёт деловой тон, а тёмные джинсы делают образ живым. Рубашку не заправляй слишком туго.' }], missing: 'Коричневые замшевые челси: кеды к пиджаку на встречу с клиентом — слишком просто.' };
  }
  return null;
}

// Serves both the Claude Messages API (/v1/messages) and the OpenAI-compatible Yandex AI Studio
// API (/v1/chat/completions). Each recorded call has { path, headers, body, system, prompt, image }.
export function startFakeClaude(port = 0, { secret = 'test-proxy-secret-123', yandexKey = 'test-yandex-key', badJsonOnce = false } = {}) {
  const calls = [];
  let spoilNext = badJsonOnce;
  const srv = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const yandex = req.url.endsWith('/chat/completions');
    const auth = req.headers.authorization || '';
    const ok = yandex ? auth === 'Api-Key ' + yandexKey : (req.headers['x-api-key'] || auth.replace(/^Bearer\s+/i, '')) === secret;
    if (!ok) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }));
    }
    const j = JSON.parse(body);
    let system, prompt, image;
    if (yandex) {
      system = j.messages[0].content;
      const u = j.messages[1].content;
      prompt = typeof u === 'string' ? u : u.find((c) => c.type === 'text').text;
      image = typeof u === 'string' ? null : u.find((c) => c.type === 'image_url') || null;
    } else {
      system = j.system?.[0]?.text || '';
      prompt = j.messages[0].content.find((c) => c.type === 'text').text;
      image = j.messages[0].content.find((c) => c.type === 'image') || null;
    }
    calls.push({ path: req.url, headers: req.headers, body: j, system, prompt, image });
    const out = taskReply(system, prompt) || (prompt.includes('не отчёт о съеденном') ? { kind: 'question', meal: null, weight_kg: null, answer: 'Сырники на 2 порции:\n• творог 5% — 400 г\n• яйцо — 1 шт.\n• мука — 2 ст. л.\nОколо 320 ккал на порцию.' } : cannedReply(prompt.split('<message>')[1] || ''));
    if (process.env.FAKE_DELAY) await new Promise((r) => setTimeout(r, +process.env.FAKE_DELAY));
    res.writeHead(200, { 'content-type': 'application/json' });
    if (yandex) {
      // the first answer can be spoiled to exercise the retry; normal answers come wrapped in a code fence
      const text = spoilNext ? '{"kind": "meal", ' : '```json\n' + JSON.stringify(out) + '\n```';
      spoilNext = false;
      return res.end(JSON.stringify({ id: 'chatcmpl-fake', object: 'chat.completion', model: j.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    }
    res.end(
      JSON.stringify({
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: j.model,
        content: [{ type: 'text', text: JSON.stringify(out) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      })
    );
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` })));
}

if (process.argv[1] && process.argv[1].endsWith('fake-claude.js')) {
  startFakeClaude(+process.argv[2] || 3399).then(({ url }) => console.log('fake AI at', url, '(Claude: /v1/messages, Yandex: /v1/chat/completions)'));
}
