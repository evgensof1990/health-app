// Model backends. Each one takes a system prompt, the user's text (and maybe a photo) and a zod
// schema, and returns an object that passed the schema, or throws an error with a status.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const fail = (msg, status = 502) => Object.assign(new Error(msg), { status });

/* ---------------- Yandex AI Studio (OpenAI-compatible API) ---------------- */

// Text goes to Alice AI LLM; photos go to Qwen3.6 35B, the multimodal model in AI Studio.
// The answer is requested as JSON that follows the schema and is validated with zod;
// on invalid JSON the model gets one more try with the error shown to it.
export class YandexBackend {
  constructor({ apiKey, folder, textModel, visionModel, baseURL, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.folder = folder;
    this.textModel = textModel || 'aliceai-llm';
    this.visionModel = visionModel || 'qwen3.6-35b-a3b';
    this.url = (baseURL || 'https://ai.api.cloud.yandex.net/v1').replace(/\/$/, '') + '/chat/completions';
    this.fetch = fetchImpl;
    this.jsonMode = true; // response_format json_object; dropped if a model rejects it
  }

  async complete({ system, text, image, schema }) {
    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    const sys = `${system}

Формат ответа: верни только JSON-объект без пояснений и без markdown, строго по этой JSON-схеме (все поля из required обязательны, для пустых значений используй null там, где это разрешено):
${jsonSchema}`;
    const user = image
      ? [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: `data:${image.mediaType || 'image/jpeg'};base64,${image.data}` } },
        ]
      : text;
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ];
    const model = `gpt://${this.folder}/${image ? this.visionModel : this.textModel}`;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.call(model, messages);
      try {
        return schema.parse(extractJson(raw));
      } catch (e) {
        lastErr = e;
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: 'Ответ не прошёл проверку схемы: ' + String(e.message).slice(0, 600) + '\nВерни исправленный JSON целиком, без пояснений.' });
      }
    }
    console.error('Yandex AI: invalid JSON', lastErr?.message);
    throw fail('ИИ ответил в неверном формате, попробуй ещё раз');
  }

  async call(model, messages) {
    let r;
    for (let i = 0; i < 3; i++) {
      try {
        r = await this.fetch(this.url, {
          method: 'POST',
          headers: { Authorization: 'Api-Key ' + this.apiKey, 'OpenAI-Project': this.folder, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 4000, ...(this.jsonMode ? { response_format: { type: 'json_object' } } : {}) }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) {
        if (i === 2) throw fail('Нет связи с ИИ, попробуй ещё раз');
        continue;
      }
      if (r.status === 400 && this.jsonMode) {
        const t = await r.clone().text();
        if (/response_format|json/i.test(t)) {
          this.jsonMode = false;
          continue;
        }
      }
      if (r.status === 429 || r.status >= 500) {
        if (i === 2) break;
        await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
        continue;
      }
      break;
    }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw fail('Яндекс не принял ключ ИИ: проверь YANDEX_API_KEY и роль ai.languageModels.user у сервисного аккаунта');
    if (r.status === 429) throw fail('ИИ перегружен, попробуй через минуту', 503);
    if (!r.ok) {
      console.error('Yandex AI', r.status, JSON.stringify(j).slice(0, 500));
      throw fail('ИИ вернул ошибку ' + r.status);
    }
    const msg = j.choices?.[0]?.message?.content;
    if (!msg) throw fail('ИИ вернул пустой ответ');
    return msg;
  }
}

// Pulls the JSON object out of a reply that may be wrapped in ```json fences or have text around it
export function extractJson(s) {
  const t = String(s).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch (e) {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw e;
  }
}

/* ---------------- Claude (through the Cloudflare proxy) ---------------- */

export class ClaudeBackend {
  constructor({ apiKey, baseURL, model, effort }) {
    this.client = new Anthropic({ apiKey, baseURL: baseURL || undefined, maxRetries: 2, timeout: 90_000 });
    this.model = model || 'claude-opus-5-5';
    this.effort = effort || 'medium';
  }

  async complete({ system, text, image, schema }) {
    const content = [];
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType || 'image/jpeg', data: image.data } });
    content.push({ type: 'text', text });
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: this.effort, format: betaZodOutputFormat(schema) },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') throw fail('ИИ отказался отвечать на это сообщение. Попробуй переформулировать.', 422);
    if (res.stop_reason === 'max_tokens' || !res.parsed_output) throw fail('ИИ ответил неполностью, попробуй ещё раз');
    return res.parsed_output;
  }
}

// Picks the backend from the environment: AI_PROVIDER=yandex (default when YANDEX_API_KEY is set) or claude
export function backendFromEnv(env) {
  const provider = env.AI_PROVIDER || (env.YANDEX_API_KEY ? 'yandex' : env.AI_PROXY_SECRET || env.ANTHROPIC_API_KEY ? 'claude' : '');
  if (provider === 'yandex' && env.YANDEX_API_KEY && env.YANDEX_FOLDER_ID) {
    return { name: 'Яндекс AI Studio', backend: new YandexBackend({ apiKey: env.YANDEX_API_KEY, folder: env.YANDEX_FOLDER_ID, textModel: env.YANDEX_TEXT_MODEL, visionModel: env.YANDEX_VISION_MODEL, baseURL: env.YANDEX_AI_URL }) };
  }
  if (provider === 'claude' && (env.AI_PROXY_SECRET || env.ANTHROPIC_API_KEY)) {
    return { name: 'Claude', backend: new ClaudeBackend({ apiKey: env.AI_PROXY_SECRET || env.ANTHROPIC_API_KEY, baseURL: env.AI_PROXY_URL, model: env.AI_MODEL, effort: env.AI_EFFORT }) };
  }
  return null;
}
