import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASKS } from '../server/tasks.js';
import { emptyState } from '../server/store.js';
import { cannedReply, taskReply } from './fake-claude.js';

const inputs = {
  books: {},
  wheel: { scores: { Здоровье: 5 } },
  reframe: { thought: 'я всё испортил' },
  jokeTask: {},
  jokeReview: { situation: 'a', technique: 'b', answer: 'c' },
  styleGuide: { profile: {} },
  styleItem: {},
  outfit: { occasion: 'офис' },
};

test('every task builds a prompt from an empty state', () => {
  for (const [name, t] of Object.entries(TASKS)) {
    const text = t.prompt(inputs[name], emptyState());
    assert.equal(typeof text, 'string', name);
    assert.ok(text.length > 5, name);
    assert.ok(!text.includes('undefined'), name + ': ' + text);
  }
});

test('canned replies match the task schemas', () => {
  for (const [name, t] of Object.entries(TASKS)) {
    const reply = taskReply(t.system, 'abc123: вещь\n');
    assert.ok(reply, name);
    t.schema.parse(reply);
  }
  assert.equal(cannedReply('съел суп').kind, 'meal');
});
