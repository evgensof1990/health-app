// Single-user storage kept as one JSON file with atomic writes.
// The server is the source of truth: the app and the Telegram bot both read and write here.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { emptySections, withSectionDefaults, SECTIONS } from '../shared/sections.js';

export const emptyState = () => ({
  profile: null, // { sex, age, height, weight, goalWeight, activity, pace, notes, targets }
  meals: [], // { id, at, text, source, title, items, kcal, protein, fat, carbs, verdict, comment, tip }
  weights: [], // { id, date: 'YYYY-MM-DD', kg }
  asks: [], // { id, at, q, a }
  sections: emptySections(),
});

export { SECTIONS };

const MAX_ASKS = 100;

export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'health.json');
    this.data = existsSync(this.file) ? { ...emptyState(), ...JSON.parse(readFileSync(this.file, 'utf8')) } : emptyState();
    this.data.sections = withSectionDefaults(this.data.sections);
    this.photoDir = join(dir, 'photos');
    mkdirSync(this.photoDir, { recursive: true });
  }

  setSection(name, value) {
    this.data.sections[name] = { ...emptySections()[name], ...value };
    this.save();
    return this.data.sections[name];
  }

  // photos are stored as files, records keep only the id
  savePhoto(buf) {
    const id = randomUUID();
    writeFileSync(join(this.photoDir, id + '.jpg'), buf);
    return id;
  }

  photoPath(id) {
    if (!/^[\w-]{36}$/.test(id)) return null;
    const p = join(this.photoDir, id + '.jpg');
    return existsSync(p) ? p : null;
  }

  deletePhoto(id) {
    const p = this.photoPath(id);
    if (p) unlinkSync(p);
  }

  save() {
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
    renameSync(this.file + '.tmp', this.file);
  }

  setProfile(profile) {
    this.data.profile = profile;
    this.save();
    return profile;
  }

  addMeal(meal) {
    const m = { id: randomUUID(), ...meal };
    this.data.meals.push(m);
    this.data.meals.sort((a, b) => a.at - b.at);
    this.save();
    return m;
  }

  updateMeal(id, patch) {
    const m = this.data.meals.find((x) => x.id === id);
    if (!m) return null;
    Object.assign(m, patch, { id });
    this.data.meals.sort((a, b) => a.at - b.at);
    this.save();
    return m;
  }

  deleteMeal(id) {
    const n = this.data.meals.length;
    this.data.meals = this.data.meals.filter((x) => x.id !== id);
    if (this.data.meals.length !== n) this.save();
    return this.data.meals.length !== n;
  }

  // one weight per day: a second entry for the same day replaces the first
  setWeight(date, kg) {
    this.data.weights = this.data.weights.filter((w) => w.date !== date);
    const w = { id: randomUUID(), date, kg };
    this.data.weights.push(w);
    this.data.weights.sort((a, b) => a.date.localeCompare(b.date));
    if (this.data.profile) this.data.profile.weight = this.data.weights.at(-1).kg;
    this.save();
    return w;
  }

  deleteWeight(id) {
    this.data.weights = this.data.weights.filter((w) => w.id !== id);
    this.save();
  }

  addAsk(q, a) {
    const x = { id: randomUUID(), at: Date.now(), q, a };
    this.data.asks.push(x);
    if (this.data.asks.length > MAX_ASKS) this.data.asks = this.data.asks.slice(-MAX_ASKS);
    this.save();
    return x;
  }
}
