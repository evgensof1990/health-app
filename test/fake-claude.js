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

export function startFakeClaude(port = 0, { secret = 'test-proxy-secret-123' } = {}) {
  const calls = [];
  const srv = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const got = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (got !== secret) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }));
    }
    const j = JSON.parse(body);
    calls.push({ headers: req.headers, body: j });
    const userText = j.messages[0].content.find((c) => c.type === 'text').text.split('<message>')[1] || '';
    const out = cannedReply(userText);
    res.writeHead(200, { 'content-type': 'application/json' });
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
  startFakeClaude(+process.argv[2] || 3399).then(({ url }) => console.log('fake Claude at', url));
}
