// Voice input: records 16 kHz mono PCM in the browser and asks the own server to recognise it
// (Yandex SpeechKit). Works in Android WebView too, unlike the Web Speech API.
import { api, getCfg } from './api.js';

export const voiceAvailable = () => !!getCfg()?.key && !!navigator.mediaDevices?.getUserMedia;

const MAX_SEC = 29;

export async function startRecording(onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d));
    let peak = 0;
    for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i]));
    onLevel?.(peak);
  };
  src.connect(proc);
  proc.connect(ctx.destination);
  const started = Date.now();
  let stopped = false;
  const stop = async () => {
    if (stopped) return null;
    stopped = true;
    proc.disconnect();
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const rate = ctx.sampleRate;
    await ctx.close();
    return toPcm16k(chunks, rate);
  };
  return { stop, started, maxMs: MAX_SEC * 1000 };
}

// Float32 at the device rate -> little-endian Int16 at 16 kHz
function toPcm16k(chunks, rate) {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const ratio = rate / 16000;
  const n = Math.floor(len / ratio);
  const out = new DataView(new ArrayBuffer(n * 2));
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(len, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    out.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return out.buffer;
}

export async function recognize(pcm) {
  const { text } = await api('POST', '/api/voice?format=lpcm', pcm, { raw: true });
  return (text || '').trim();
}
