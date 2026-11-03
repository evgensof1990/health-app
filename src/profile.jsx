import { useMemo, useState } from 'react';
import { api } from './api.js';
import { ACTIVITY, PACE, calcTargets } from '../shared/nutrition.js';
import { Icon } from './icons.jsx';

const fmt = (n) => n.toLocaleString('ru-RU');

export function ProfileForm({ profile, onSaved, onClose }) {
  const [p, setP] = useState(() => ({ sex: 'm', age: '', height: '', weight: '', goalWeight: '', activity: 'light', pace: 'gentle', notes: '', ...(profile || {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
  const nums = { ...p, age: +p.age, height: +p.height, weight: +String(p.weight).replace(',', '.'), goalWeight: +String(p.goalWeight || '').replace(',', '.') || null };
  const t = useMemo(() => calcTargets(nums), [p]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { profile } = await api('PUT', '/api/profile', nums);
      onSaved(profile);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page form">
      <div className="topbar">
        <h1 className="h1">{profile ? 'Профиль' : 'Познакомимся'}</h1>
        {onClose && (
          <button className="iconbtn" onClick={onClose} data-back aria-label="Закрыть">
            <Icon name="x" />
          </button>
        )}
      </div>
      {!profile && <p className="muted">Нужно для нормы калорий и честных советов. Займёт полминуты.</p>}
      <div className="seg">
        {[
          ['m', 'Мужчина'],
          ['f', 'Женщина'],
        ].map(([v, l]) => (
          <button key={v} className={p.sex === v ? 'on' : ''} onClick={() => setP((x) => ({ ...x, sex: v }))}>
            {l}
          </button>
        ))}
      </div>
      <div className="row3">
        <label className="field">
          <span>Возраст</span>
          <input value={p.age} onChange={set('age')} inputMode="numeric" />
        </label>
        <label className="field">
          <span>Рост, см</span>
          <input value={p.height} onChange={set('height')} inputMode="numeric" />
        </label>
        <label className="field">
          <span>Вес, кг</span>
          <input value={p.weight} onChange={set('weight')} inputMode="decimal" />
        </label>
      </div>
      <label className="field">
        <span>Желаемый вес, кг (можно пропустить)</span>
        <input value={p.goalWeight || ''} onChange={set('goalWeight')} inputMode="decimal" />
      </label>
      <label className="field">
        <span>Активность</span>
        <select value={p.activity} onChange={set('activity')}>
          {Object.entries(ACTIVITY).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Темп</span>
        <select value={p.pace} onChange={set('pace')}>
          {Object.entries(PACE).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Что учесть (необязательно)</span>
        <textarea rows={2} value={p.notes} onChange={set('notes')} placeholder="Например: не ем рыбу, люблю сладкое вечером, работаю сидя" />
      </label>
      {t && (
        <div className="card targets">
          <div className="big">{fmt(t.kcal)} ккал в день</div>
          <div className="muted">
            Белки {t.protein} г · Жиры {t.fat} г · Углеводы {t.carbs} г. Расход без дефицита около {fmt(t.tdee)} ккал.
          </div>
        </div>
      )}
      {err && <div className="note err">{err}</div>}
      <button className="btn primary" disabled={busy || !t} onClick={save}>
        {busy ? 'Сохраняю…' : 'Сохранить'}
      </button>
    </div>
  );
}
