// Turns the AI's structured reply into stored records.
import { sumItems, dayKey } from '../shared/nutrition.js';

const r1 = (x) => Math.round(x * 10) / 10;

export function mealFromReply(meal, { text, source, at }) {
  const items = meal.items.map((i) => ({ ...i, grams: Math.round(i.grams), kcal: Math.round(i.kcal), protein: r1(i.protein), fat: r1(i.fat), carbs: r1(i.carbs) }));
  return {
    at,
    text,
    source,
    title: meal.title,
    items,
    ...sumItems(items),
    verdict: meal.verdict,
    comment: meal.comment,
    tip: meal.tip || null,
  };
}

// now: request time; at: explicit time from the client (e.g. a meal logged for yesterday)
export function applyReply(store, reply, { text, source = 'app', at = null, now = Date.now() }) {
  if (reply.kind === 'meal' && reply.meal) {
    const ago = reply.meal.eaten_minutes_ago;
    const when = at ?? (ago && ago > 0 && ago < 24 * 60 ? now - ago * 6e4 : now);
    return { kind: 'meal', meal: store.addMeal(mealFromReply(reply.meal, { text, source, at: when })) };
  }
  if (reply.kind === 'weight' && reply.weight_kg && reply.weight_kg > 30 && reply.weight_kg < 300) {
    return { kind: 'weight', weight: store.setWeight(dayKey(at ?? now), r1(reply.weight_kg)) };
  }
  if (reply.kind === 'question' && reply.answer) {
    return { kind: 'question', ask: store.addAsk(text || '(фото)', reply.answer) };
  }
  return { kind: 'unclear', answer: reply.answer || 'Не понял. Скажи, что съел, или задай вопрос.' };
}
