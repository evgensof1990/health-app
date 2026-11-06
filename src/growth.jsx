import { useState } from 'react';
import { aiTask } from './api.js';
import { dayKey, shiftDay } from '../shared/nutrition.js';
import { STARTER_BOOKS, HABIT_PRESETS, DEFAULT_HABITS, WHEEL_AREAS, TIPS } from './content.js';
import { useSection, useAction, Seg, Err, Busy, WeekDots, plural, uid, useStored } from './ui.jsx';
import { Icon } from './icons.jsx';

const last7 = () => Array.from({ length: 7 }, (_, i) => shiftDay(dayKey(), i - 6));
const dayNum = (key = dayKey()) => Math.floor(new Date(key + 'T12:00:00').getTime() / 864e5);

// consecutive days ending today (or yesterday, so the streak does not drop in the morning)
export function streak(has) {
  let d = dayKey();
  if (!has(d)) d = shiftDay(d, -1);
  let n = 0;
  while (has(d)) {
    n++;
    d = shiftDay(d, -1);
  }
  return n;
}

export function GrowthScreen({ data, setData }) {
  const [tab, setTab] = useStored('growth-tab', 'books');
  const [g, update, saveErr] = useSection(data, setData, 'growth');
  return (
    <div className="page">
      <h1 className="h1">Развитие</h1>
      <Seg
        value={tab}
        onChange={setTab}
        items={[
          ['books', 'Чтение'],
          ['habits', 'Привычки'],
          ['wheel', 'Баланс'],
          ['tips', 'Советы'],
        ]}
      />
      <Err>{saveErr}</Err>
      {tab === 'books' && <Books g={g} update={update} />}
      {tab === 'habits' && <Habits g={g} update={update} />}
      {tab === 'wheel' && <Wheel g={g} update={update} />}
      {tab === 'tips' && <Tips g={g} update={update} />}
    </div>
  );
}

/* ---------------- reading ---------------- */

function Books({ g, update }) {
  const [wish, setWish] = useState('');
  const [recs, setRecs] = useState(null);
  const [logFor, setLogFor] = useState(null);
  const { busy, error, run } = useAction();
  const reading = g.books.filter((b) => b.status === 'reading');
  const want = g.books.filter((b) => b.status === 'want');
  const done = g.books.filter((b) => b.status === 'done' || b.status === 'dropped');
  const readDays = new Set(g.reading.map((r) => r.date));
  const st = streak((d) => readDays.has(d));
  const weekMin = g.reading.filter((r) => r.date > shiftDay(dayKey(), -7)).reduce((s, r) => s + (r.minutes || 0), 0);
  const onShelf = (t) => g.books.some((b) => b.title.toLowerCase() === t.toLowerCase());

  const add = (b, status = 'want') => update((x) => ({ ...x, books: [...x.books, { id: uid(), title: b.title, author: b.author, pages: b.pages || null, why: b.why || '', status, page: 0, added: Date.now() }] }));
  const setBook = (id, patch) => update((x) => ({ ...x, books: x.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const remove = (id) => update((x) => ({ ...x, books: x.books.filter((b) => b.id !== id) }));

  const suggest = () =>
    run(async () => {
      const r = await aiTask('books', { wish });
      setRecs(r.books);
    });

  return (
    <>
      <div className="card statrow">
        <div>
          <div className="big">{st}</div>
          <div className="muted small">{plural(st, 'день', 'дня', 'дней')} подряд</div>
        </div>
        <div>
          <div className="big">{weekMin}</div>
          <div className="muted small">минут за 7 дней</div>
        </div>
        <WeekDots days={last7()} isOn={(d) => readDays.has(d)} />
      </div>

      {reading.map((b) => (
        <div className="card book reading" key={b.id}>
          <div className="btitle">{b.title}</div>
          <div className="muted small">{b.author}</div>
          {b.pages ? (
            <>
              <div className="bar mt">
                <div style={{ width: Math.min(100, ((b.page || 0) / b.pages) * 100) + '%', background: 'var(--accent)' }} />
              </div>
              <div className="muted small mt4">
                стр. {b.page || 0} из {b.pages}
              </div>
            </>
          ) : null}
          {logFor === b.id ? (
            <ReadLog
              book={b}
              onCancel={() => setLogFor(null)}
              onSave={(minutes, page) => {
                update((x) => ({
                  ...x,
                  reading: [...x.reading, { id: uid(), date: dayKey(), minutes, bookId: b.id, page }],
                  books: x.books.map((y) => (y.id === b.id ? { ...y, page: page || y.page, status: y.pages && page >= y.pages ? 'done' : y.status } : y)),
                }));
                setLogFor(null);
              }}
            />
          ) : (
            <div className="row mt">
              <button className="btn primary grow" onClick={() => setLogFor(b.id)}>
                Почитал
              </button>
              <button className="btn" onClick={() => setBook(b.id, { status: 'done' })}>
                Дочитал
              </button>
              <button className="iconbtn" onClick={() => setBook(b.id, { status: 'dropped' })} aria-label="Бросить">
                <Icon name="x" size={18} />
              </button>
            </div>
          )}
        </div>
      ))}

      {reading.length === 0 && <div className="note">Сейчас ничего не читаешь. Выбери книгу из списка ниже и нажми «Начать». Цель скромная: 10 минут в день.</div>}

      {want.length > 0 && <h2 className="h2">Хочу прочитать</h2>}
      {want.map((b) => (
        <div className="card book" key={b.id}>
          <div className="row top">
            <div className="grow">
              <div className="btitle">{b.title}</div>
              <div className="muted small">
                {b.author}
                {b.pages ? ` · ${b.pages} стр.` : ''}
              </div>
            </div>
            <button className="btn small" onClick={() => setBook(b.id, { status: 'reading', started: Date.now() })}>
              Начать
            </button>
            <button className="iconbtn" onClick={() => remove(b.id)} aria-label="Убрать">
              <Icon name="trash" size={16} />
            </button>
          </div>
          {b.why && <div className="small muted mt4">{b.why}</div>}
        </div>
      ))}

      <h2 className="h2">Подобрать книги</h2>
      <div className="card">
        <textarea className="ta" rows={3} value={wish} onChange={(e) => setWish(e.target.value)} placeholder="Что интересно? Например: психология, история, фантастика, хочу что-то лёгкое и смешное" />
        <button className="btn primary full mt" onClick={suggest} disabled={busy}>
          {busy ? 'Подбираю…' : 'Подобрать 5 книг'}
        </button>
        <Err>{error}</Err>
      </div>
      {busy && <Busy text="Подбираю книги под тебя" />}
      {(recs || STARTER_BOOKS).map((b) => (
        <div className="card book" key={b.title}>
          <div className="row top">
            <div className="grow">
              <div className="btitle">{b.title}</div>
              <div className="muted small">
                {b.author} · {b.pages} стр.
              </div>
            </div>
            {onShelf(b.title) ? (
              <span className="muted small">на полке</span>
            ) : (
              <button className="btn small" onClick={() => add(b)}>
                На полку
              </button>
            )}
          </div>
          <div className="small mt4">{b.why}</div>
          {b.start && <div className="small muted mt4">Как начать: {b.start}</div>}
        </div>
      ))}
      {!recs && <div className="muted small center-text">Стартовая подборка, чтобы вернуться к чтению. Кнопка выше подберёт под твои интересы.</div>}

      {done.length > 0 && <h2 className="h2">Прочитано</h2>}
      {done.map((b) => (
        <div className="card book" key={b.id}>
          <div className="row">
            <div className="grow">
              <div className="btitle">{b.title}</div>
              <div className="muted small">
                {b.author}
                {b.status === 'dropped' ? ' · брошена' : ''}
              </div>
            </div>
            {b.status === 'done' && <Stars value={b.rating || 0} onChange={(r) => setBook(b.id, { rating: r })} />}
          </div>
        </div>
      ))}
    </>
  );
}

function ReadLog({ book, onSave, onCancel }) {
  const [min, setMin] = useState(15);
  const [page, setPage] = useState(book.page ? String(book.page) : '');
  return (
    <div className="readlog mt">
      <div className="muted small">Сколько минут?</div>
      <div className="chips">
        {[10, 15, 20, 30, 45, 60].map((m) => (
          <button key={m} className={'chip' + (min === m ? ' on' : '')} onClick={() => setMin(m)}>
            {m}
          </button>
        ))}
      </div>
      <input className="inp mt" inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} placeholder="На какой странице остановился (необязательно)" />
      <div className="row mt">
        <button className="btn" onClick={onCancel}>
          Отмена
        </button>
        <button className="btn primary grow" onClick={() => onSave(min, Number(page) || null)}>
          Записать
        </button>
      </div>
    </div>
  );
}

function Stars({ value, onChange }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} className={i <= value ? 'on' : ''} onClick={() => onChange(i)} aria-label={`${i} из 5`}>
          ★
        </button>
      ))}
    </div>
  );
}

/* ---------------- habits ---------------- */

export function habitList(g) {
  return (g.habits || DEFAULT_HABITS.map((id) => HABIT_PRESETS.find((h) => h.id === id))).filter(Boolean);
}

function Habits({ g, update }) {
  const [edit, setEdit] = useState(false);
  const [custom, setCustom] = useState('');
  const today = dayKey();
  const list = habitList(g);
  const log = g.habitLog || {};
  const doneToday = log[today] || [];
  const days = last7();

  const toggle = (id) =>
    update((x) => {
      const cur = new Set((x.habitLog || {})[today] || []);
      cur.has(id) ? cur.delete(id) : cur.add(id);
      return { ...x, habitLog: { ...x.habitLog, [today]: [...cur] } };
    });
  const setHabits = (habits) => update((x) => ({ ...x, habits }));

  if (edit) {
    const ids = new Set(list.map((h) => h.id));
    const all = [...HABIT_PRESETS, ...list.filter((h) => !HABIT_PRESETS.some((p) => p.id === h.id))];
    return (
      <>
        <div className="muted small mb">Отметь, что хочешь отслеживать. Лучше начать с 3–4 привычек, а не с десяти.</div>
        {all.map((h) => (
          <button key={h.id} className={'card check' + (ids.has(h.id) ? ' on' : '')} onClick={() => setHabits(ids.has(h.id) ? list.filter((x) => x.id !== h.id) : [...list, { id: h.id, title: h.title, hint: h.hint }])}>
            <span className="box">{ids.has(h.id) ? '✓' : ''}</span>
            <span className="grow">
              {h.title}
              {h.hint && <div className="muted small">{h.hint}</div>}
            </span>
          </button>
        ))}
        <div className="row mt">
          <input className="inp grow" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Своя привычка" />
          <button
            className="btn"
            disabled={!custom.trim()}
            onClick={() => {
              setHabits([...list, { id: uid(), title: custom.trim() }]);
              setCustom('');
            }}
          >
            Добавить
          </button>
        </div>
        <button className="btn primary full mt" onClick={() => setEdit(false)}>
          Готово
        </button>
      </>
    );
  }

  return (
    <>
      <div className="card statrow">
        <div>
          <div className="big">
            {doneToday.filter((id) => list.some((h) => h.id === id)).length} / {list.length}
          </div>
          <div className="muted small">сегодня</div>
        </div>
        <div className="muted small grow right">Отмечай вечером. Пропуск — не провал: важна не идеальная серия, а возвращение на следующий день.</div>
      </div>
      {list.map((h) => {
        const on = doneToday.includes(h.id);
        const s = streak((d) => (log[d] || []).includes(h.id));
        return (
          <button key={h.id} className={'card check habit' + (on ? ' on' : '')} onClick={() => toggle(h.id)}>
            <span className="box">{on ? '✓' : ''}</span>
            <span className="grow">
              {h.title}
              <WeekDots days={days} isOn={(d) => (log[d] || []).includes(h.id)} />
            </span>
            {s > 1 && <span className="streak">{s} 🔥</span>}
          </button>
        );
      })}
      <button className="btn full mt" onClick={() => setEdit(true)}>
        <Icon name="edit" size={16} /> Настроить привычки
      </button>
    </>
  );
}

/* ---------------- balance wheel ---------------- */

function Wheel({ g, update }) {
  const lastW = g.wheel.at(-1);
  const [scores, setScores] = useState(() => lastW?.scores || Object.fromEntries(WHEEL_AREAS.map((a) => [a, 5])));
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(!lastW);
  const { busy, error, run } = useAction();
  const prev = g.wheel.at(-2);
  const daysSince = lastW ? Math.round((new Date(dayKey() + 'T12:00:00') - new Date(lastW.date + 'T12:00:00')) / 864e5) : null;

  const save = () =>
    run(async () => {
      const entry = { id: uid(), at: Date.now(), date: dayKey(), scores: { ...scores }, note };
      let advice = null;
      try {
        advice = await aiTask('wheel', { scores, note, prev: lastW?.scores, prevDate: lastW?.date });
      } catch (e) {
        /* keep the scores even if AI is unavailable */
      }
      if (advice) entry.advice = { ...advice, steps: advice.steps.map((s) => ({ ...s, done: false })) };
      await update((x) => ({ ...x, wheel: [...x.wheel, entry] }));
      setEditing(false);
      setNote('');
      if (!advice) throw new Error('Оценки сохранены, но совет от ИИ получить не удалось');
    });

  const toggleStep = (i) => update((x) => ({ ...x, wheel: x.wheel.map((w, k) => (k === x.wheel.length - 1 ? { ...w, advice: { ...w.advice, steps: w.advice.steps.map((s, j) => (j === i ? { ...s, done: !s.done } : s)) } } : w)) }));

  if (editing) {
    return (
      <>
        <div className="muted small mb">Оцени каждую сферу от 1 до 10: насколько ты доволен ей сейчас. Не думай долго, первая цифра обычно самая честная. Повторяй раз в неделю-две.</div>
        {WHEEL_AREAS.map((a) => (
          <div className="slider" key={a}>
            <div className="row">
              <span className="grow">{a}</span>
              <b>{scores[a]}</b>
            </div>
            <input type="range" min="1" max="10" value={scores[a]} onChange={(e) => setScores((s) => ({ ...s, [a]: +e.target.value }))} />
          </div>
        ))}
        <textarea className="ta mt" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что сейчас происходит? (необязательно)" />
        <button className="btn primary full mt" onClick={save} disabled={busy}>
          {busy ? 'Сохраняю и думаю…' : 'Сохранить и получить совет'}
        </button>
        {lastW && (
          <button className="btn full mt" onClick={() => setEditing(false)}>
            Отмена
          </button>
        )}
        <Err>{error}</Err>
      </>
    );
  }

  return (
    <>
      <div className="card">
        <Radar areas={WHEEL_AREAS} now={lastW.scores} prev={prev?.scores} />
        <div className="legend small">
          <span>
            <i style={{ background: 'var(--accent)' }} /> {lastW.date.split('-').reverse().slice(0, 2).join('.')}
          </span>
          {prev && (
            <span>
              <i style={{ background: 'var(--text3)' }} /> {prev.date.split('-').reverse().slice(0, 2).join('.')}
            </span>
          )}
        </div>
      </div>
      <Err>{error}</Err>
      {lastW.advice && (
        <div className="card">
          <div className="a">{lastW.advice.summary}</div>
          <div className="h3 mt">Шаги на неделю</div>
          {lastW.advice.steps.map((s, i) => (
            <button key={i} className={'check plain' + (s.done ? ' on' : '')} onClick={() => toggleStep(i)}>
              <span className="box">{s.done ? '✓' : ''}</span>
              <span className="grow">
                <span className="muted small">{s.area}</span>
                <div>{s.action}</div>
              </span>
            </button>
          ))}
        </div>
      )}
      <button className="btn primary full mt" onClick={() => setEditing(true)}>
        {daysSince >= 7 ? 'Пора обновить оценки' : 'Обновить оценки'}
      </button>
      {daysSince != null && <div className="muted small center-text mt4">Последняя оценка {daysSince === 0 ? 'сегодня' : `${daysSince} ${plural(daysSince, 'день', 'дня', 'дней')} назад`}</div>}
    </>
  );
}

function Radar({ areas, now, prev }) {
  const R = 105;
  const c = 150;
  const pt = (i, v) => {
    const a = (Math.PI * 2 * i) / areas.length - Math.PI / 2;
    return [c + Math.cos(a) * (R * v) / 10, c + Math.sin(a) * (R * v) / 10];
  };
  const poly = (s) => areas.map((a, i) => pt(i, s[a] || 0).join(',')).join(' ');
  return (
    <svg viewBox="-45 -5 390 310" className="radar">
      {[2, 4, 6, 8, 10].map((v) => (
        <polygon key={v} points={areas.map((_, i) => pt(i, v).join(',')).join(' ')} fill="none" stroke="var(--surface3)" />
      ))}
      {areas.map((a, i) => {
        const [x, y] = pt(i, 10);
        const [lx, ly] = pt(i, 12.6);
        return (
          <g key={a}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="var(--surface3)" />
            <text x={lx} y={ly} textAnchor={lx < c - 5 ? 'end' : lx > c + 5 ? 'start' : 'middle'} dominantBaseline="middle" className="rlabel">
              {a.split(' ')[0]} {now[a]}
            </text>
          </g>
        );
      })}
      {prev && <polygon points={poly(prev)} fill="none" stroke="var(--text3)" strokeDasharray="4 3" strokeWidth="1.5" />}
      <polygon points={poly(now)} fill="color-mix(in srgb, var(--accent) 25%, transparent)" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

/* ---------------- tips ---------------- */

function Tips({ g, update }) {
  const [offset, setOffset] = useState(0);
  const doneSet = new Set(g.tipsDone || []);
  const todo = TIPS.map((t, i) => ({ ...t, i })).filter((t) => !doneSet.has(t.title));
  const pool = todo.length ? todo : TIPS.map((t, i) => ({ ...t, i }));
  const tip = pool[(dayNum() + offset) % pool.length];
  const done = TIPS.map((t, i) => ({ ...t, i })).filter((t) => doneSet.has(t.title));
  return (
    <>
      <div className="card tipcard">
        <div className="muted small">
          Совет дня · {tip.area}
        </div>
        <div className="btitle mt4">{tip.title}</div>
        <div className="a mt4">{tip.text}</div>
        <div className="row mt">
          <button className="btn primary grow" onClick={() => update((x) => ({ ...x, tipsDone: [...new Set([...(x.tipsDone || []), tip.title])] }))} disabled={doneSet.has(tip.title)}>
            {doneSet.has(tip.title) ? 'Уже в жизни' : 'Попробовал, работает'}
          </button>
          <button className="btn" onClick={() => setOffset((o) => o + 1)}>
            Другой
          </button>
        </div>
      </div>
      <div className="muted small center-text">
        Внедрено {done.length} из {TIPS.length}. Каждый день новый совет: попробуй его в течение недели, и если прижился, отметь.
      </div>
      {done.length > 0 && <h2 className="h2">Уже в жизни</h2>}
      {done.map((t) => (
        <div key={t.i} className="card slim">
          <div className="row">
            <span className="grow">
              {t.title}
              <span className="muted small"> · {t.area}</span>
            </span>
            <button className="iconbtn" onClick={() => update((x) => ({ ...x, tipsDone: (x.tipsDone || []).filter((k) => k !== t.title) }))} aria-label="Вернуть">
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
