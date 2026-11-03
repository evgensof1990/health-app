import { useEffect, useRef, useState } from 'react';
import { api, shrinkImage } from './api.js';
import { startRecording, recognize, voiceAvailable } from './voice.js';
import { dayKey, dayRange, shiftDay, mealsOn, totals, VERDICT, weightTrend } from '../shared/nutrition.js';
import { Icon } from './icons.jsx';

const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const uid = () => Math.random().toString(36).slice(2);

function dayTitle(key) {
  const today = dayKey();
  if (key === today) return 'Сегодня';
  if (key === shiftDay(today, -1)) return 'Вчера';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}

// Time for an entry logged while looking at another day: that day, current time of day
function atFor(key) {
  if (key === dayKey()) return null;
  const now = new Date();
  const [a] = dayRange(key);
  return a + (now.getHours() * 60 + now.getMinutes()) * 6e4;
}

export function FoodScreen({ data, setData, refresh, offlineError, onSettings, onProfile }) {
  const [day, setDay] = useState(dayKey());
  const [pending, setPending] = useState([]);
  const [answer, setAnswer] = useState(null);
  const [open, setOpen] = useState(null);
  const today = dayKey();
  const meals = mealsOn(data.meals, day);
  const [a, b] = dayRange(day);
  const asks = data.asks.filter((x) => x.at >= a && x.at < b);
  const t = totals(meals);
  const target = data.profile?.targets;

  const patchPending = (id, p) => setPending((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const dropPending = (id) => setPending((list) => list.filter((x) => x.id !== id));

  const send = async (item) => {
    patchPending(item.id, { status: 'thinking', error: null });
    try {
      const r = await api('POST', '/api/input', { text: item.text, image: item.image ? { data: item.image.data, mediaType: item.image.mediaType } : null, at: item.at, source: item.source });
      dropPending(item.id);
      if (r.kind === 'meal') {
        setData((d) => ({ ...d, meals: [...d.meals, r.meal].sort((x, y) => x.at - y.at) }));
        setOpen(r.meal.id);
      } else if (r.kind === 'weight') {
        setData((d) => ({ ...d, weights: [...d.weights.filter((w) => w.date !== r.weight.date), r.weight].sort((x, y) => x.date.localeCompare(y.date)) }));
        setAnswer({ q: item.text, a: `Записал вес ${String(r.weight.kg).replace('.', ',')} кг.` });
      } else if (r.kind === 'question') {
        setData((d) => ({ ...d, asks: [...d.asks, r.ask] }));
        setAnswer({ q: r.ask.q, a: r.ask.a });
      } else setAnswer({ q: item.text, a: r.answer });
    } catch (e) {
      patchPending(item.id, { status: 'error', error: e.message });
    }
  };

  const submit = (text, image, source = 'text') => {
    const item = { id: uid(), text, image, at: atFor(day), source, status: 'thinking' };
    setPending((l) => [...l, item]);
    send(item);
  };

  // voice: the recording is turned into text first, so the transcript shows up while Claude thinks
  const submitVoice = async (pcm) => {
    const item = { id: uid(), text: '', at: atFor(day), source: 'voice', status: 'voice' };
    setPending((l) => [...l, item]);
    try {
      const text = await recognize(pcm);
      if (!text) {
        patchPending(item.id, { status: 'error', error: 'Не расслышал. Попробуй ещё раз или напиши текстом.' });
        return;
      }
      item.text = text;
      patchPending(item.id, { text });
      send(item);
    } catch (e) {
      patchPending(item.id, { status: 'error', error: e.message, pcm });
    }
  };

  const retry = (item) => (item.text ? send(item) : (dropPending(item.id), item.pcm && submitVoice(item.pcm)));

  const feed = [...meals.map((m) => ({ type: 'meal', at: m.at, m })), ...asks.map((q) => ({ type: 'ask', at: q.at, q }))].sort((x, y) => x.at - y.at);

  return (
    <div className="food">
      <div className="page">
        <div className="topbar">
          <div className="daynav">
            <button className="iconbtn" onClick={() => setDay(shiftDay(day, -1))} aria-label="Предыдущий день">
              <Icon name="left" />
            </button>
            <button className="daytitle" onClick={() => setDay(today)}>
              {dayTitle(day)}
            </button>
            <button className="iconbtn" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))} aria-label="Следующий день">
              <Icon name="right" />
            </button>
          </div>
          <button className="iconbtn" onClick={onSettings} aria-label="Настройки">
            <Icon name="gear" />
          </button>
        </div>

        {offlineError && <div className="note err">Нет связи с сервером, показываю сохранённое. {offlineError}</div>}

        <Summary t={t} target={target} onProfile={onProfile} />

        {answer && (
          <div className="card answer">
            <button className="close" onClick={() => setAnswer(null)} aria-label="Скрыть">
              <Icon name="x" size={16} />
            </button>
            {answer.q && <div className="q">«{answer.q}»</div>}
            <div className="a">{answer.a}</div>
          </div>
        )}

        <div className="feed">
          {feed.length === 0 && pending.length === 0 && <Empty isToday={day === today} />}
          {feed.map((x) =>
            x.type === 'meal' ? (
              <MealCard key={x.m.id} m={x.m} open={open === x.m.id} onToggle={() => setOpen(open === x.m.id ? null : x.m.id)} setData={setData} />
            ) : (
              <AskCard key={x.q.id} q={x.q} />
            )
          )}
          {pending.map((p) => (
            <PendingCard key={p.id} p={p} onRetry={() => retry(p)} onDrop={() => dropPending(p.id)} />
          ))}
        </div>

        <WeightCard weights={data.weights} profile={data.profile} setData={setData} day={day} />
      </div>
      <Composer onText={(t) => submit(t, null, 'text')} onPhoto={(img, t) => submit(t, img, 'photo')} onVoice={submitVoice} />
    </div>
  );
}

function Summary({ t, target, onProfile }) {
  if (!target) {
    return (
      <button className="card summary" onClick={onProfile}>
        <div className="big">{fmt(t.kcal)} ккал</div>
        <div className="muted">Заполни профиль, чтобы видеть норму</div>
      </button>
    );
  }
  const left = target.kcal - t.kcal;
  const pct = Math.min(1, t.kcal / target.kcal);
  const over = left < 0;
  return (
    <div className="card summary">
      <div className="sumtop">
        <Ring pct={pct} over={over} />
        <div>
          <div className="big">
            {fmt(t.kcal)} <span className="of">/ {fmt(target.kcal)} ккал</span>
          </div>
          <div className={over ? 'warn' : 'muted'}>{over ? `Больше нормы на ${fmt(-left)}` : `Осталось ${fmt(left)} ккал`}</div>
        </div>
      </div>
      <div className="macros">
        <Macro label="Белки" v={t.protein} max={target.protein} color="var(--p)" />
        <Macro label="Жиры" v={t.fat} max={target.fat} color="var(--f)" />
        <Macro label="Углеводы" v={t.carbs} max={target.carbs} color="var(--c)" />
      </div>
    </div>
  );
}

function Ring({ pct, over }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="ring">
      <circle cx="28" cy="28" r={r} stroke="var(--surface3)" strokeWidth="6" fill="none" />
      <circle cx="28" cy="28" r={r} stroke={over ? 'var(--red)' : 'var(--accent)'} strokeWidth="6" fill="none" strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" transform="rotate(-90 28 28)" />
    </svg>
  );
}

function Macro({ label, v, max, color }) {
  return (
    <div className="macro">
      <div className="ml">{label}</div>
      <div className="bar">
        <div style={{ width: Math.min(100, (v / max) * 100) + '%', background: color }} />
      </div>
      <div className="mv">
        {fmt(v)} <span className="muted">/ {max} г</span>
      </div>
    </div>
  );
}

function Empty({ isToday }) {
  return (
    <div className="empty">
      {isToday ? (
        <>
          <div className="big">Что ты сегодня ел?</div>
          <div className="muted">
            Нажми на микрофон и скажи, например: «съел тарелку борща со сметаной и кусок хлеба». Или спроси: «хочу копчёную куриную ножку, это ок?»
          </div>
        </>
      ) : (
        <div className="muted">В этот день записей нет. Можно добавить задним числом.</div>
      )}
    </div>
  );
}

function Verdict({ v }) {
  const x = VERDICT[v] || VERDICT.ok;
  return (
    <span className="verdict" style={{ color: x.color, background: `color-mix(in srgb, ${x.color} 14%, transparent)` }}>
      {x.label}
    </span>
  );
}

function MealCard({ m, open, onToggle, setData }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(m.text);
  const [time, setTime] = useState(hhmm(m.at));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const [h, mi] = time.split(':').map(Number);
    const d = new Date(m.at);
    d.setHours(h, mi, 0, 0);
    try {
      const r = await api('PATCH', '/api/meals/' + m.id, { text, at: d.getTime() });
      setData((s) => ({ ...s, meals: s.meals.map((x) => (x.id === m.id ? r.meal : x)).sort((x, y) => x.at - y.at) }));
      setEdit(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      await api('DELETE', '/api/meals/' + m.id);
      setData((s) => ({ ...s, meals: s.meals.filter((x) => x.id !== m.id) }));
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className={'card meal' + (open ? ' open' : '')}>
      <button className="mealhead" onClick={onToggle}>
        <span className="time">{hhmm(m.at)}</span>
        <span className="title">{m.title}</span>
        <span className="kcal">{fmt(m.kcal)}</span>
      </button>
      <div className="mealsub">
        <Verdict v={m.verdict} />
        <span className="muted small">
          Б{Math.round(m.protein)} Ж{Math.round(m.fat)} У{Math.round(m.carbs)}
        </span>
      </div>
      <div className="comment">{m.comment}</div>
      {open && (
        <div className="details">
          {m.tip && <div className="tip">💡 {m.tip}</div>}
          <table className="items">
            <tbody>
              {m.items.map((i, k) => (
                <tr key={k}>
                  <td>{i.name}</td>
                  <td className="muted">{i.grams} г</td>
                  <td className="num">{fmt(i.kcal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!edit ? (
            <div className="actions">
              <span className="muted small said">«{m.text || 'фото'}»</span>
              <button className="iconbtn" onClick={() => setEdit(true)} aria-label="Исправить">
                <Icon name="edit" size={18} />
              </button>
              <button className="iconbtn" onClick={del} disabled={busy} aria-label="Удалить">
                <Icon name="trash" size={18} />
              </button>
            </div>
          ) : (
            <div className="editbox">
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: не 200, а 300 г гречки" />
              <div className="editrow">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                <button className="btn" onClick={() => setEdit(false)}>
                  Отмена
                </button>
                <button className="btn primary" onClick={save} disabled={busy}>
                  {busy ? 'Пересчитываю…' : 'Сохранить'}
                </button>
              </div>
            </div>
          )}
          {err && <div className="note err">{err}</div>}
        </div>
      )}
    </div>
  );
}

function AskCard({ q }) {
  return (
    <div className="card ask">
      <div className="q">
        <Icon name="chat" size={14} /> {hhmm(q.at)} · {q.q}
      </div>
      <div className="a">{q.a}</div>
    </div>
  );
}

function PendingCard({ p, onRetry, onDrop }) {
  return (
    <div className={'card pending' + (p.status === 'error' ? ' failed' : '')}>
      {p.image?.preview && <img src={p.image.preview} alt="" className="thumb" />}
      <div className="ptext">
        {p.text ? `«${p.text}»` : p.status === 'voice' ? 'Распознаю голос…' : ''}
        <div className="muted small">{p.status === 'thinking' ? 'Считаю калории…' : p.status === 'error' ? p.error : ''}</div>
      </div>
      {p.status === 'error' ? (
        <div className="pact">
          <button className="iconbtn" onClick={onRetry} aria-label="Повторить">
            <Icon name="retry" size={18} />
          </button>
          <button className="iconbtn" onClick={onDrop} aria-label="Убрать">
            <Icon name="x" size={18} />
          </button>
        </div>
      ) : (
        <span className="spinner" />
      )}
    </div>
  );
}

function WeightCard({ weights, profile, setData, day }) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const recent = weightTrend(weights.filter((w) => w.date > shiftDay(dayKey(), -60)));
  const last = weights.at(-1);
  const first30 = recent.find((w) => w.date > shiftDay(dayKey(), -30));

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { weight } = await api('POST', '/api/weights', { kg: Number(val.replace(',', '.')), date: day });
      setData((d) => ({ ...d, weights: [...d.weights.filter((w) => w.date !== weight.date), weight].sort((x, y) => x.date.localeCompare(y.date)) }));
      setVal('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const delta = last && first30 ? Math.round((last.kg - first30.kg) * 10) / 10 : null;
  return (
    <div className="card weight">
      <div className="wtop">
        <Icon name="scale" size={18} />
        <span className="wl">Вес</span>
        {last && <span className="big">{String(last.kg).replace('.', ',')} кг</span>}
        {delta != null && delta !== 0 && <span className={delta < 0 ? 'good small' : 'warn small'}>{(delta > 0 ? '+' : '') + String(delta).replace('.', ',')} за 30 дн.</span>}
      </div>
      {recent.length >= 2 && <Spark points={recent} goal={profile?.goalWeight} />}
      <div className="wadd">
        <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" placeholder={day === dayKey() ? 'Вес сегодня, кг' : 'Вес в этот день, кг'} onKeyDown={(e) => e.key === 'Enter' && val && add()} />
        <button className="btn" disabled={!val || busy} onClick={add}>
          Записать
        </button>
      </div>
      {err && <div className="note err">{err}</div>}
      <div className="muted small">Взвешивайся утром натощак. Линия — среднее за 7 дней, на неё и смотри: дневные скачки — это вода.</div>
    </div>
  );
}

function Spark({ points, goal }) {
  const w = 300;
  const h = 70;
  const data = points.flatMap((p) => [p.kg, p.avg]);
  // show the goal line only when it is close enough not to flatten the chart
  const vals = goal && goal > Math.min(...data) - 2 ? data.concat([goal]) : data;
  const lo = Math.min(...vals) - 0.5;
  const hi = Math.max(...vals) + 0.5;
  const x = (i) => (i / (points.length - 1)) * (w - 8) + 4;
  const y = (v) => h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
      {goal && goal > lo && goal < hi && <line x1="0" x2={w} y1={y(goal)} y2={y(goal)} stroke="var(--text3)" strokeDasharray="4 4" />}
      {points.map((p, i) => (
        <circle key={p.date} cx={x(i)} cy={y(p.kg)} r="2" fill="var(--text3)" />
      ))}
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Composer({ onText, onPhoto, onVoice }) {
  const [text, setText] = useState('');
  const [rec, setRec] = useState(null);
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);
  const recRef = useRef(null);

  useEffect(() => {
    if (!rec) return;
    const iv = setInterval(() => {
      const s = (Date.now() - rec.started) / 1000;
      setSecs(Math.floor(s));
      if (s * 1000 >= rec.maxMs) stop();
    }, 250);
    return () => clearInterval(iv);
  }, [rec]);

  const start = async () => {
    setErr(null);
    try {
      const r = await startRecording((l) => setLevel(l));
      recRef.current = r;
      setRec(r);
      navigator.vibrate?.(20);
    } catch (e) {
      setErr('Нет доступа к микрофону. Разреши его в настройках телефона.');
    }
  };

  const stop = async () => {
    const r = recRef.current;
    recRef.current = null;
    setRec(null);
    setSecs(0);
    if (!r) return;
    const pcm = await r.stop();
    if (pcm && pcm.byteLength > 16000) onVoice(pcm); // shorter than ~0.5 s is a mis-tap
  };

  const sendText = () => {
    const t = text.trim();
    if (photo) {
      onPhoto(photo, t);
      setPhoto(null);
    } else if (t) onText(t);
    else return;
    setText('');
  };

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      setPhoto(await shrinkImage(f));
    } catch (er) {
      setErr(er.message);
    }
  };

  const canSend = text.trim() || photo;
  return (
    <div className="composer">
      {err && (
        <div className="note err" onClick={() => setErr(null)}>
          {err}
        </div>
      )}
      {photo && (
        <div className="photo">
          <img src={photo.preview} alt="" />
          <span className="muted small">Можешь добавить подпись: «половину не доел»</span>
          <button className="iconbtn" onClick={() => setPhoto(null)} aria-label="Убрать фото">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      <div className="cbar">
        <button className="iconbtn" onClick={() => fileRef.current?.click()} aria-label="Фото еды">
          <Icon name="camera" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        {rec ? (
          <div className="recording">
            <span className="dot" style={{ transform: `scale(${1 + Math.min(1, level * 3)})` }} />
            Говори… 0:{String(secs).padStart(2, '0')}
          </div>
        ) : (
          <input className="cinput" value={text} onChange={(e) => setText(e.target.value)} placeholder="Что съел или что спросить" onKeyDown={(e) => e.key === 'Enter' && sendText()} enterKeyHint="send" />
        )}
        {canSend && !rec ? (
          <button className="mic" onClick={sendText} aria-label="Отправить">
            <Icon name="send" size={22} />
          </button>
        ) : (
          <button className={'mic' + (rec ? ' on' : '')} onClick={rec ? stop : start} disabled={!voiceAvailable()} aria-label={rec ? 'Остановить запись' : 'Сказать голосом'}>
            <Icon name={rec ? 'stop' : 'mic'} size={24} />
          </button>
        )}
      </div>
    </div>
  );
}
