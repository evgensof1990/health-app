import { useRef, useState } from 'react';
import { aiTask, api, shrinkImage, uploadPhoto } from './api.js';
import { BUILD_OPTIONS } from './content.js';
import { useSection, useAction, Seg, Err, Busy, Photo, VoiceField, uid, useStored } from './ui.jsx';
import { Icon } from './icons.jsx';

const CATS = [
  ['all', 'Все'],
  ['top', 'Верх'],
  ['outer', 'Верхняя'],
  ['bottom', 'Низ'],
  ['shoes', 'Обувь'],
  ['accessory', 'Аксессуары'],
];
const VERDICT = {
  keep: { label: 'Оставить', color: '#4cc38a' },
  ok: { label: 'С оговорками', color: '#f0b44f' },
  replace: { label: 'Заменить', color: '#f0574f' },
};

export function StyleScreen({ data, setData }) {
  const [tab, setTab] = useStored('style-tab', 'guide');
  const [st, update, saveErr] = useSection(data, setData, 'style');
  return (
    <div className="page">
      <h1 className="h1">Стиль и имидж</h1>
      <Seg
        value={tab}
        onChange={setTab}
        items={[
          ['guide', 'Гайд'],
          ['wardrobe', 'Гардероб'],
          ['look', 'Образ'],
          ['shop', 'Покупки'],
        ]}
      />
      <Err>{saveErr}</Err>
      {tab === 'guide' && <Guide st={st} update={update} goShop={() => setTab('shop')} />}
      {tab === 'wardrobe' && <Wardrobe st={st} update={update} />}
      {tab === 'look' && <Look st={st} update={update} />}
      {tab === 'shop' && <Shopping st={st} update={update} />}
    </div>
  );
}

const addToShop = (update, text, why = '', priority = 2) =>
  update((x) => (x.shopping.some((s) => s.text === text) ? x : { ...x, shopping: [...x.shopping, { id: uid(), text, why, priority, done: false, at: Date.now() }] }));

/* ---------------- style guide ---------------- */

function Guide({ st, update, goShop }) {
  const [p, setP] = useState(() => st.profile || { build: '', life: '', image: '', budget: '', likes: '' });
  const [editing, setEditing] = useState(!st.guide);
  const { busy, error, run } = useAction();
  const set = (k) => (v) => setP((x) => ({ ...x, [k]: typeof v === 'string' ? v : v.target.value }));
  const go = () =>
    run(async () => {
      const guide = await aiTask('styleGuide', { profile: p });
      await update((x) => ({ ...x, profile: p, guide: { ...guide, at: Date.now() } }));
      setEditing(false);
    });
  const g = st.guide;

  if (editing) {
    return (
      <>
        <div className="muted small mb">Ответь на пять вопросов, и ИИ соберёт личный гайд: цвета, базовую капсулу, правила посадки и что купить в первую очередь.</div>
        <div className="field">
          <span>Телосложение</span>
          <div className="chips">
            {BUILD_OPTIONS.map((b) => (
              <button key={b} className={'chip' + (p.build === b ? ' on' : '')} onClick={() => set('build')(b)}>
                {b}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Образ жизни: где бываешь чаще всего</span>
          <VoiceField value={p.life} onChange={set('life')} placeholder="Офис без дресс-кода, встречи с клиентами, выходные за городом, дети" />
        </label>
        <label className="field">
          <span>Каким хочешь выглядеть</span>
          <VoiceField value={p.image} onChange={set('image')} placeholder="Собранным и уверенным, но без пафоса; моложе; солиднее" />
        </label>
        <label className="field">
          <span>Бюджет на одежду в месяц</span>
          <div className="chips">
            {['до 5 000 ₽', '5–15 тыс. ₽', '15–30 тыс. ₽', 'больше 30 тыс. ₽'].map((b) => (
              <button key={b} className={'chip' + (p.budget === b ? ' on' : '')} onClick={() => set('budget')(b)}>
                {b}
              </button>
            ))}
          </div>
        </label>
        <label className="field">
          <span>Что нравится и что не носишь</span>
          <VoiceField value={p.likes} onChange={set('likes')} placeholder="Люблю джинсы и кроссовки, не ношу галстуки, не люблю яркое" />
        </label>
        <button className="btn primary full" onClick={go} disabled={busy}>
          {busy ? 'Собираю гайд…' : 'Собрать мой гайд'}
        </button>
        {g && (
          <button className="btn full mt" onClick={() => setEditing(false)}>
            Отмена
          </button>
        )}
        {busy && <Busy text="Это займёт до минуты" />}
        <Err>{error}</Err>
      </>
    );
  }

  return (
    <>
      <div className="card">
        <div className="a">{g.summary}</div>
      </div>
      <h2 className="h2">Твои цвета</h2>
      <div className="chips">
        {g.colors.map((c) => (
          <span key={c} className="chip static">
            {c}
          </span>
        ))}
      </div>
      <h2 className="h2">Базовая капсула</h2>
      {[...g.capsule]
        .sort((a, b) => a.priority - b.priority)
        .map((c) => {
          const inShop = st.shopping.some((s) => s.text === c.item);
          return (
            <div key={c.item} className="card slim">
              <div className="row top">
                <span className={'prio p' + c.priority}>{c.priority}</span>
                <div className="grow">
                  <div>{c.item}</div>
                  <div className="muted small">{c.why}</div>
                </div>
                <button className="iconbtn" onClick={() => addToShop(update, c.item, c.why, c.priority)} disabled={inShop} aria-label="В покупки">
                  {inShop ? '✓' : '+'}
                </button>
              </div>
            </div>
          );
        })}
      <div className="muted small center-text">1 — купить в первую очередь. Плюсик добавляет вещь в список покупок.</div>
      <h2 className="h2">Правила</h2>
      <div className="card">
        <ul className="list">
          {g.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <h2 className="h2">Чего избегать</h2>
      <div className="card">
        <ul className="list">
          {g.avoid.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div className="row mt">
        <button className="btn grow" onClick={() => setEditing(true)}>
          Изменить ответы
        </button>
        <button className="btn primary grow" onClick={goShop}>
          К покупкам
        </button>
      </div>
    </>
  );
}

/* ---------------- wardrobe ---------------- */

function Wardrobe({ st, update }) {
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(null);
  const { busy, error, run } = useAction();
  const fileRef = useRef(null);
  const items = st.items.filter((i) => cat === 'all' || i.category === cat);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    await run(async () => {
      const img = await shrinkImage(f, 1024);
      setPending(img.preview);
      const photoId = await uploadPhoto(img.data);
      try {
        const r = await aiTask('styleItem', { note }, photoId);
        await update((x) => ({ ...x, items: [...x.items, { id: uid(), photoId, at: Date.now(), ...r }] }));
        setNote('');
      } catch (er) {
        api('DELETE', '/api/photos/' + photoId).catch(() => {});
        throw er;
      }
    });
    setPending(null);
  };

  const remove = (it) => {
    update((x) => ({ ...x, items: x.items.filter((y) => y.id !== it.id) }));
    api('DELETE', '/api/photos/' + it.photoId).catch(() => {});
    setOpen(null);
  };

  const sel = open && st.items.find((i) => i.id === open);
  if (sel) {
    const v = VERDICT[sel.verdict] || VERDICT.ok;
    return (
      <>
        <button className="btn small mb" onClick={() => setOpen(null)} data-back>
          <Icon name="left" size={16} /> Гардероб
        </button>
        <Photo id={sel.photoId} className="bigphoto" />
        <div className="card mt">
          <div className="btitle">{sel.name}</div>
          <div className="row mt4">
            <span className="verdict" style={{ color: v.color, background: `color-mix(in srgb, ${v.color} 14%, transparent)` }}>
              {v.label}
            </span>
            <span className="muted small">
              {sel.color} · {sel.formality} · {(sel.season || []).join(', ')}
            </span>
          </div>
          <div className="a mt">{sel.note}</div>
        </div>
        <div className="row">
          {sel.verdict === 'replace' && (
            <button className="btn grow" onClick={() => addToShop(update, 'Замена: ' + sel.name, sel.note, 2)}>
              Добавить замену в покупки
            </button>
          )}
          <button className="btn" onClick={() => remove(sel)}>
            <Icon name="trash" size={16} /> Удалить
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="card">
        <div className="muted small">Сфотографируй вещь на однотонном фоне или на себе. ИИ определит, что это, и скажет: оставить, носить с оговорками или заменить.</div>
        <input className="inp mt" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий к фото (необязательно): «ношу 5 лет», «куплена на распродаже»" />
        <button className="btn primary full mt" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icon name="camera" size={18} /> {busy ? 'Смотрю вещь…' : 'Добавить вещь'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        <Err>{error}</Err>
      </div>
      {st.items.length > 0 && <Seg value={cat} onChange={setCat} items={CATS} />}
      <div className="grid">
        {pending && (
          <div className="tile">
            <img src={pending} alt="" />
            <span className="spinner over" />
          </div>
        )}
        {[...items].reverse().map((i) => (
          <button key={i.id} className="tile" onClick={() => setOpen(i.id)}>
            <Photo id={i.photoId} />
            <span className="vdot" style={{ background: (VERDICT[i.verdict] || VERDICT.ok).color }} />
            <span className="tname">{i.name}</span>
          </button>
        ))}
      </div>
      {st.items.length === 0 && !pending && <div className="muted small center-text">Начни с 5–10 вещей, которые носишь чаще всего. Так быстрее станет понятно, чего не хватает.</div>}
      {st.items.length > 0 && (
        <div className="muted small center-text">
          {st.items.length} вещей · заменить: {st.items.filter((i) => i.verdict === 'replace').length}
        </div>
      )}
    </>
  );
}

/* ---------------- outfit of the day ---------------- */

function Look({ st, update }) {
  const [occasion, setOccasion] = useState('');
  const [weather, setWeather] = useState('');
  const { busy, error, run } = useAction();
  const go = () =>
    run(async () => {
      const r = await aiTask('outfit', { occasion, weather });
      await update((x) => ({ ...x, looks: [...x.looks.slice(-19), { id: uid(), at: Date.now(), occasion, weather, ...r }] }));
    });
  const byId = Object.fromEntries(st.items.map((i) => [i.id, i]));
  const list = [...st.looks].reverse();

  if (st.items.length < 3) {
    return <div className="note">Сначала добавь хотя бы 3–5 вещей во вкладке «Гардероб»: образы собираются из твоих вещей.</div>;
  }
  return (
    <>
      <div className="card">
        <div className="chips">
          {['Офис', 'Встреча с клиентом', 'Свидание', 'Выходные с семьёй', 'Вечеринка', 'Поездка'].map((o) => (
            <button key={o} className={'chip' + (occasion === o ? ' on' : '')} onClick={() => setOccasion(o)}>
              {o}
            </button>
          ))}
        </div>
        <input className="inp mt" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Или свой повод" />
        <input className="inp mt" value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="Погода: например, +5, дождь" />
        <button className="btn primary full mt" onClick={go} disabled={busy || !occasion.trim()}>
          {busy ? 'Собираю образ…' : 'Собрать образ'}
        </button>
        <Err>{error}</Err>
      </div>
      {busy && <Busy text="Перебираю гардероб" />}
      {list.map((l) => (
        <div key={l.id} className="lookset">
          <div className="dayhead">
            {l.occasion}
            {l.weather ? ` · ${l.weather}` : ''}
          </div>
          {l.looks.map((k, i) => (
            <div key={i} className="card">
              <div className="btitle">{k.title}</div>
              <div className="lookrow mt">
                {k.itemIds
                  .map((id) => byId[id])
                  .filter(Boolean)
                  .map((it) => (
                    <div key={it.id} className="lookitem">
                      <Photo id={it.photoId} />
                      <span className="small">{it.name}</span>
                    </div>
                  ))}
              </div>
              <div className="small muted mt">{k.why}</div>
            </div>
          ))}
          {l.missing && (
            <div className="card slim">
              <div className="row">
                <span className="grow small">🛍 {l.missing}</span>
                <button className="btn small" onClick={() => addToShop(update, l.missing, 'Для повода: ' + l.occasion, 2)}>
                  В покупки
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/* ---------------- shopping list ---------------- */

function Shopping({ st, update }) {
  const [text, setText] = useState('');
  const todo = st.shopping.filter((s) => !s.done).sort((a, b) => a.priority - b.priority);
  const done = st.shopping.filter((s) => s.done);
  const toggle = (id) => update((x) => ({ ...x, shopping: x.shopping.map((s) => (s.id === id ? { ...s, done: !s.done, doneAt: Date.now() } : s)) }));
  const remove = (id) => update((x) => ({ ...x, shopping: x.shopping.filter((s) => s.id !== id) }));
  return (
    <>
      <div className="row">
        <input className="inp grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Добавить вещь" onKeyDown={(e) => e.key === 'Enter' && text.trim() && (addToShop(update, text.trim()), setText(''))} />
        <button
          className="btn"
          disabled={!text.trim()}
          onClick={() => {
            addToShop(update, text.trim());
            setText('');
          }}
        >
          Добавить
        </button>
      </div>
      {todo.length === 0 && <div className="muted small center-text mt">Список пуст. Добавляй вещи из гайда и образов плюсиком или вручную.</div>}
      <div className="mt">
        {todo.map((s) => (
          <div key={s.id} className="card slim shop">
            <button className="box" onClick={() => toggle(s.id)} aria-label="Куплено" />
            <span className={'prio p' + s.priority}>{s.priority}</span>
            <div className="grow">
              <div>{s.text}</div>
              {s.why && <div className="muted small">{s.why}</div>}
            </div>
            <button className="iconbtn" onClick={() => remove(s.id)} aria-label="Удалить">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      {done.length > 0 && <h2 className="h2">Куплено</h2>}
      {done.map((s) => (
        <div key={s.id} className="card slim shop done">
          <button className="box on" onClick={() => toggle(s.id)} aria-label="Вернуть">
            ✓
          </button>
          <div className="grow">{s.text}</div>
          <button className="iconbtn" onClick={() => remove(s.id)} aria-label="Удалить">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </>
  );
}
