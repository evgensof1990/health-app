import { useState } from 'react';
import { aiTask } from './api.js';
import { dayKey, shiftDay } from '../shared/nutrition.js';
import { PRACTICES, HUMOR_TECHNIQUES } from './content.js';
import { useSection, useAction, Seg, Err, Busy, WeekDots, VoiceField, plural, uid, useStored } from './ui.jsx';
import { streak } from './growth.jsx';
import { Icon } from './icons.jsx';

const last7 = () => Array.from({ length: 7 }, (_, i) => shiftDay(dayKey(), i - 6));
const fmtDay = (key) => {
  const today = dayKey();
  if (key === today) return 'Сегодня';
  if (key === shiftDay(today, -1)) return 'Вчера';
  return new Date(key + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

export function SelfScreen({ data, setData }) {
  const [tab, setTab] = useStored('self-tab', 'practice');
  const [s, update, saveErr] = useSection(data, setData, 'self');
  return (
    <div className="page">
      <h1 className="h1">Самооценка и юмор</h1>
      <Seg
        value={tab}
        onChange={setTab}
        items={[
          ['practice', 'Практика'],
          ['wins', 'Победы'],
          ['thoughts', 'Мысли'],
          ['humor', 'Юмор'],
        ]}
      />
      <Err>{saveErr}</Err>
      {tab === 'practice' && <Practice s={s} update={update} />}
      {tab === 'wins' && <Wins s={s} update={update} />}
      {tab === 'thoughts' && <Thoughts s={s} update={update} />}
      {tab === 'humor' && <Humor s={s} update={update} />}
    </div>
  );
}

/* ---------------- daily practice ---------------- */

function Practice({ s, update }) {
  const today = dayKey();
  const log = s.practiceLog || {};
  const doneDays = Object.keys(log).sort();
  const todayEntry = log[today];
  const idx = todayEntry ? todayEntry.idx : doneDays.length % PRACTICES.length;
  const p = PRACTICES[idx];
  const [note, setNote] = useState(todayEntry?.note || '');
  const st = streak((d) => !!log[d]);
  const history = doneDays
    .filter((d) => d !== today)
    .slice(-10)
    .reverse();

  return (
    <>
      <div className="card statrow">
        <div>
          <div className="big">{doneDays.length}</div>
          <div className="muted small">из {PRACTICES.length} практик</div>
        </div>
        <div>
          <div className="big">{st}</div>
          <div className="muted small">{plural(st, 'день', 'дня', 'дней')} подряд</div>
        </div>
        <WeekDots days={last7()} isOn={(d) => !!log[d]} />
      </div>
      <div className={'card practice ' + p.kind}>
        <div className="muted small">
          День {idx + 1} · {p.kind === 'humor' ? 'юмор' : 'самооценка'} · 5 минут
        </div>
        <div className="btitle mt4">{p.title}</div>
        <div className="a mt4">{p.text}</div>
        <VoiceField value={note} onChange={setNote} placeholder="Запиши ответ: текстом или голосом" rows={4} />
        <button className="btn primary full mt" disabled={!note.trim()} onClick={() => update((x) => ({ ...x, practiceLog: { ...x.practiceLog, [today]: { idx, note: note.trim(), at: Date.now() } } }))}>
          {todayEntry ? (todayEntry.note === note.trim() ? 'Сделано ✓' : 'Сохранить изменения') : 'Готово'}
        </button>
      </div>
      <div className="muted small center-text">Одна практика в день. Пропустил — ничего страшного, завтра продолжишь с того же места.</div>
      {history.length > 0 && <h2 className="h2">Прошлые ответы</h2>}
      {history.map((d) => (
        <div key={d} className="card slim">
          <div className="muted small">
            {fmtDay(d)} · {PRACTICES[log[d].idx]?.title}
          </div>
          <div className="small mt4">{log[d].note}</div>
        </div>
      ))}
    </>
  );
}

/* ---------------- wins diary ---------------- */

function Wins({ s, update }) {
  const [text, setText] = useState('');
  const today = dayKey();
  const todayWins = s.wins.filter((w) => w.date === today);
  const byDay = {};
  for (const w of s.wins) (byDay[w.date] ||= []).push(w);
  const days = Object.keys(byDay).sort().reverse();
  const st = streak((d) => !!byDay[d]);

  const add = () => {
    if (!text.trim()) return;
    update((x) => ({ ...x, wins: [...x.wins, { id: uid(), date: today, text: text.trim(), at: Date.now() }] }));
    setText('');
  };

  return (
    <>
      <div className="card">
        <div className="btitle">{todayWins.length >= 3 ? 'Три победы есть 💪' : `Победа ${todayWins.length + 1} из 3`}</div>
        <div className="muted small mt4">Что сегодня получилось? Подходит что угодно: сделал зарядку, не сорвался на ребёнка, закрыл задачу, выбрал салат вместо бургера. Мозг замечает плохое сам, а хорошее нужно учить замечать.</div>
        <VoiceField value={text} onChange={setText} placeholder="Сегодня у меня получилось…" />
        <button className="btn primary full mt" onClick={add} disabled={!text.trim()}>
          Записать
        </button>
      </div>
      {st > 1 && <div className="muted small center-text">{st} {plural(st, 'день', 'дня', 'дней')} подряд замечаешь хорошее</div>}
      {days.map((d) => (
        <div key={d}>
          <div className="dayhead">{fmtDay(d)}</div>
          {byDay[d].map((w) => (
            <div key={w.id} className="card slim win">
              <span className="grow">{w.text}</span>
              <button className="iconbtn" onClick={() => update((x) => ({ ...x, wins: x.wins.filter((y) => y.id !== w.id) }))} aria-label="Удалить">
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/* ---------------- thoughts (CBT reframing) ---------------- */

function Thoughts({ s, update }) {
  const [thought, setThought] = useState('');
  const { busy, error, run } = useAction();
  const go = () =>
    run(async () => {
      const r = await aiTask('reframe', { thought });
      await update((x) => ({ ...x, reframes: [...x.reframes, { id: uid(), at: Date.now(), thought: thought.trim(), ...r }] }));
      setThought('');
    });
  const list = [...s.reframes].reverse();
  return (
    <>
      <div className="card">
        <div className="btitle">Разобрать мысль</div>
        <div className="muted small mt4">Когда что-то задело или крутится в голове «я опять всё испортил», «он подумал, что я дурак», запиши как есть. Разберём, где факты, а где искажение, и посмотрим трезво.</div>
        <VoiceField value={thought} onChange={setThought} placeholder="Что случилось и что ты подумал о себе" rows={3} />
        <button className="btn primary full mt" onClick={go} disabled={busy || !thought.trim()}>
          {busy ? 'Разбираю…' : 'Разобрать'}
        </button>
        <Err>{error}</Err>
      </div>
      {busy && <Busy text="Разбираю мысль" />}
      {list.map((r) => (
        <div key={r.id} className="card reframe">
          <div className="q">«{r.thought}»</div>
          {r.distortion && (
            <div className="small mt4">
              <b>Искажение:</b> {r.distortion}
            </div>
          )}
          <div className="a mt4">{r.reframe}</div>
          <div className="tip mt4">👉 {r.action}</div>
        </div>
      ))}
    </>
  );
}

/* ---------------- humor trainer ---------------- */

function Humor({ s, update }) {
  const [technique, setTechnique] = useState('');
  const [level, setLevel] = useStored('humor-level', 'средний');
  const [answer, setAnswer] = useState('');
  const { busy, error, run } = useAction();
  const cur = s.jokes.at(-1);
  const open = cur && !cur.review ? cur : null;
  const avg = (() => {
    const r = s.jokes.filter((j) => j.review).slice(-10);
    return r.length ? Math.round((r.reduce((a, j) => a + j.review.score, 0) / r.length) * 10) / 10 : null;
  })();

  const next = () =>
    run(async () => {
      const t = await aiTask('jokeTask', { technique, level });
      await update((x) => ({ ...x, jokes: [...x.jokes, { id: uid(), at: Date.now(), ...t }] }));
      setAnswer('');
    });
  const check = () =>
    run(async () => {
      const r = await aiTask('jokeReview', { situation: open.situation, technique: open.technique, answer });
      await update((x) => ({ ...x, jokes: x.jokes.map((j) => (j.id === open.id ? { ...j, answer: answer.trim(), review: r } : j)) }));
    });
  const history = s.jokes.filter((j) => j.review).reverse();

  return (
    <>
      {avg != null && (
        <div className="card statrow">
          <div>
            <div className="big">{avg}</div>
            <div className="muted small">средний балл, последние 10</div>
          </div>
          <div>
            <div className="big">{history.length}</div>
            <div className="muted small">{plural(history.length, 'упражнение', 'упражнения', 'упражнений')}</div>
          </div>
        </div>
      )}
      {open ? (
        <div className="card">
          <div className="muted small">Техника: {open.technique}</div>
          <div className="a mt4">{open.situation}</div>
          <div className="small muted mt4">💡 {open.hint}</div>
          <VoiceField value={answer} onChange={setAnswer} placeholder="Твой ответ или шутка" rows={3} />
          <button className="btn primary full mt" onClick={check} disabled={busy || !answer.trim()}>
            {busy ? 'Оцениваю…' : 'Оценить'}
          </button>
          <button className="btn full mt" onClick={next} disabled={busy}>
            Другое задание
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="btitle">Тренажёр остроумия</div>
          <div className="muted small mt4">Получаешь жизненную ситуацию и пробуешь ответить смешно. ИИ оценит, покажет, как усилить твою шутку, и даст пару вариантов. 5 минут в день, и через месяц шутки начнут приходить в голову сами.</div>
          <div className="muted small mt">Техника</div>
          <div className="chips">
            <button className={'chip' + (!technique ? ' on' : '')} onClick={() => setTechnique('')}>
              любая
            </button>
            {HUMOR_TECHNIQUES.map((t) => (
              <button key={t} className={'chip' + (technique === t ? ' on' : '')} onClick={() => setTechnique(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="muted small mt">Сложность</div>
          <div className="chips">
            {['лёгкий', 'средний', 'сложный'].map((l) => (
              <button key={l} className={'chip' + (level === l ? ' on' : '')} onClick={() => setLevel(l)}>
                {l}
              </button>
            ))}
          </div>
          <button className="btn primary full mt" onClick={next} disabled={busy}>
            {busy ? 'Придумываю…' : 'Дай задание'}
          </button>
        </div>
      )}
      <Err>{error}</Err>
      {history.map((j) => (
        <div key={j.id} className="card joke">
          <div className="row top">
            <div className="grow small muted">{j.situation}</div>
            <span className={'score s' + Math.min(9, Math.max(1, Math.round(j.review.score)))}>{j.review.score}</span>
          </div>
          <div className="mt4">«{j.answer}»</div>
          <div className="small mt4">
            <span className="good">+</span> {j.review.works}
          </div>
          <div className="small mt4">
            <span className="warn">↑</span> {j.review.improve}
          </div>
          <details className="mt4">
            <summary className="small muted">Варианты</summary>
            {j.review.variants.map((v, i) => (
              <div key={i} className="small variant">
                {v}
              </div>
            ))}
          </details>
        </div>
      ))}
    </>
  );
}
