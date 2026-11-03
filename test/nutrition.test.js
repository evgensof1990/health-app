import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcTargets, dayKey, shiftDay, mealsOn, totals, weightTrend } from '../shared/nutrition.js';

test('targets: gentle deficit, protein from goal weight', () => {
  const t = calcTargets({ sex: 'm', age: 35, height: 180, weight: 92, goalWeight: 82, activity: 'light', pace: 'gentle' });
  // BMR = 920 + 1125 - 175 + 5 = 1875; TDEE = 2578; -12% = 2269
  assert.equal(t.kcal, 2270);
  assert.equal(t.protein, Math.round(82 * 1.6));
  assert.ok(t.carbs > 150);
});

test('targets never go below a safe floor', () => {
  const t = calcTargets({ sex: 'f', age: 60, height: 150, weight: 45, activity: 'sedentary', pace: 'normal' });
  assert.equal(t.kcal, 1300);
});

test('days and totals', () => {
  const k = '2026-11-03';
  assert.equal(shiftDay(k, 1), '2026-11-04');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  const at = new Date(2026, 10, 3, 13).getTime();
  const ms = [{ at, kcal: 500, protein: 30, fat: 20, carbs: 50 }, { at: at + 864e5, kcal: 100 }];
  assert.equal(dayKey(at), k);
  assert.deepEqual(totals(mealsOn(ms, k)), { kcal: 500, protein: 30, fat: 20, carbs: 50 });
});

test('weight trend averages the last 7 days', () => {
  const w = weightTrend([
    { date: '2026-11-01', kg: 92 },
    { date: '2026-11-02', kg: 91 },
    { date: '2026-11-03', kg: 93 },
  ]);
  assert.equal(w[2].avg, 92);
});
