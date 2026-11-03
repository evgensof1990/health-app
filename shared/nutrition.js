// Pure nutrition helpers shared by the app and the server.

export const ACTIVITY = {
  sedentary: { k: 1.2, label: 'Сидячий образ жизни' },
  light: { k: 1.375, label: 'Лёгкая активность (1–3 тренировки в неделю)' },
  moderate: { k: 1.55, label: 'Средняя (3–5 тренировок)' },
  high: { k: 1.725, label: 'Высокая (6–7 тренировок)' },
};

// pace = desired weight loss: gentle by default, so it does not feel like a struggle
export const PACE = {
  keep: { deficit: 0, label: 'Держать вес' },
  gentle: { deficit: 0.12, label: 'Мягко, ≈0,3 кг в неделю' },
  normal: { deficit: 0.2, label: 'Обычно, ≈0,5 кг в неделю' },
};

const r5 = (x) => Math.round(x / 5) * 5;

// Mifflin–St Jeor BMR × activity, minus a deficit; protein from the goal weight.
export function calcTargets(p) {
  if (!p || !p.weight || !p.height || !p.age) return null;
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'f' ? -161 : 5);
  const tdee = bmr * (ACTIVITY[p.activity]?.k || 1.375);
  const deficit = PACE[p.pace]?.deficit ?? PACE.gentle.deficit;
  const floor = p.sex === 'f' ? 1300 : 1600;
  const kcal = r5(Math.max(floor, tdee * (1 - deficit)));
  const ref = Math.min(p.weight, Math.max(p.goalWeight || p.weight, p.weight * 0.85));
  const protein = Math.round(ref * 1.6);
  const fat = Math.round(ref * 0.9);
  const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs, tdee: r5(tdee) };
}

// Local calendar day for a timestamp, 'YYYY-MM-DD' (server runs with TZ=Europe/Moscow)
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayRange(key) {
  const [y, m, d] = key.split('-').map(Number);
  const from = new Date(y, m - 1, d).getTime();
  return [from, new Date(y, m - 1, d + 1).getTime()];
}

export function shiftDay(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12).getTime());
}

export function mealsOn(meals, key) {
  const [a, b] = dayRange(key);
  return meals.filter((m) => m.at >= a && m.at < b);
}

export function totals(meals) {
  const t = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const m of meals) for (const k in t) t[k] += m[k] || 0;
  for (const k in t) t[k] = Math.round(t[k]);
  return t;
}

// Sum items into the meal-level numbers
export function sumItems(items) {
  return totals(items || []);
}

export const VERDICT = {
  great: { label: 'Отлично', color: '#4cc38a' },
  ok: { label: 'Нормально', color: '#a3c94c' },
  meh: { label: 'Так себе', color: '#f0b44f' },
  bad: { label: 'Лучше реже', color: '#f0574f' },
};

// Simple 7-day moving average to smooth daily weight noise
export function weightTrend(weights) {
  const out = [];
  for (let i = 0; i < weights.length; i++) {
    const [a] = dayRange(weights[i].date);
    const win = weights.filter((w) => {
      const [t] = dayRange(w.date);
      return t <= a && t > a - 7 * 864e5;
    });
    out.push({ date: weights[i].date, kg: weights[i].kg, avg: Math.round((win.reduce((s, w) => s + w.kg, 0) / win.length) * 10) / 10 });
  }
  return out;
}
