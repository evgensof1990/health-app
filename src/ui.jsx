import { useEffect, useRef, useState } from 'react';
import { api, photoUrl } from './api.js';
import { startRecording, recognize, voiceAvailable } from './voice.js';
import { Icon } from './icons.jsx';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// Read and save one of the sections (growth / self / style). Saves the whole object; on failure
// the change stays on screen and the error is shown, the next change retries.
export function useSection(data, setData, name) {
  const value = data.sections?.[name] || {};
  const ref = useRef(value);
  ref.current = value;
  const [error, setError] = useState(null);
  const update = async (fn) => {
    // the ref keeps the latest value, so quick successive taps do not overwrite each other
    const next = typeof fn === 'function' ? fn(ref.current) : fn;
    ref.current = next;
    setData((d) => ({ ...d, sections: { ...d.sections, [name]: next } }));
    try {
      await api('PUT', '/api/sections/' + name, next);
      setError(null);
    } catch (e) {
      setError('Не сохранилось: ' + e.message);
    }
  };
  return [value, update, error];
}

// Runs an async action with busy/error state
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function Seg({ value, onChange, items }) {
  return (
    <div className="seg subtabs">
      {items.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function useStored(key, init) {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) || init;
    } catch (e) {
      return init;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, v);
    } catch (e) {
      /* ignore */
    }
  }, [key, v]);
  return [v, setV];
}

export const Err = ({ children }) => (children ? <div className="note err">{children}</div> : null);

export const Busy = ({ text }) => (
  <div className="busy">
    <span className="spinner" /> {text}
  </div>
);

// Text field with a mic: speech is appended to the text
export function VoiceField({ value, onChange, placeholder, rows = 2, autoFocus }) {
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const recRef = useRef(null);
  useEffect(() => {
    if (!rec) return;
    const t = setTimeout(stop, rec.maxMs);
    return () => clearTimeout(t);
  }, [rec]);
  const start = async () => {
    setErr(null);
    try {
      recRef.current = await startRecording();
      setRec(recRef.current);
    } catch (e) {
      setErr('Нет доступа к микрофону');
    }
  };
  const stop = async () => {
    const r = recRef.current;
    recRef.current = null;
    setRec(null);
    if (!r) return;
    const pcm = await r.stop();
    if (!pcm || pcm.byteLength < 16000) return;
    setBusy(true);
    try {
      const t = await recognize(pcm);
      if (t) onChange((value ? value.trim() + ' ' : '') + t);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vfield">
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={rec ? 'Говори…' : busy ? 'Распознаю…' : placeholder} autoFocus={autoFocus} />
      {voiceAvailable() && (
        <button className={'vmic' + (rec ? ' on' : '')} onClick={rec ? stop : start} disabled={busy} aria-label={rec ? 'Остановить' : 'Сказать голосом'}>
          <Icon name={rec ? 'stop' : 'mic'} size={18} />
        </button>
      )}
      {err && <div className="small warn">{err}</div>}
    </div>
  );
}

export function Photo({ id, className, alt = '' }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    if (id)
      photoUrl(id)
        .then((u) => alive && setSrc(u))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  return src ? <img src={src} className={className} alt={alt} /> : <div className={(className || '') + ' ph'} />;
}

// Last 7 days as dots
export function WeekDots({ days, isOn }) {
  return (
    <div className="dots">
      {days.map((d) => (
        <span key={d} className={'d' + (isOn(d) ? ' on' : '')} title={d} />
      ))}
    </div>
  );
}

export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
};
