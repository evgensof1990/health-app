// Yandex SpeechKit short audio recognition (up to 30 s / 1 MB)
export function speechKit(apiKey, fetchImpl = fetch) {
  return async (audio, format = 'oggopus') => {
    const q = new URLSearchParams({ lang: 'ru-RU', format, ...(format === 'lpcm' ? { sampleRateHertz: '16000' } : {}) });
    const r = await fetchImpl('https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?' + q, { method: 'POST', headers: { Authorization: 'Api-Key ' + apiKey }, body: audio });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error_message || 'SpeechKit ответил ' + r.status), { status: 502 });
    return j.result || '';
  };
}
