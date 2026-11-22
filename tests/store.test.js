import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commit, createHistory } from '../src/store.js';
import { activeBookings } from '../src/rules.js';
import { fresh, TODAY } from './helpers.js';
import { addDays } from '../src/time.js';

test('a plan with one bad step changes nothing at all', () => {
  const s = fresh();
  const [a, b] = activeBookings(s, addDays(TODAY, 1)).filter((x) => x.staffId === 'elira');
  const plan = { type: 'plan', steps: [
    { type: 'cancel', id: a.id, reason: 'test' },
    { type: 'move', id: b.id, to: { staffId: 'marco' } }, // Marco can't do physio: must fail
  ] };
  const r = commit(s, plan);
  assert.ok(r.error);
  assert.equal(r.state, s, 'original state returned');
  assert.equal(s.bookings.find((x) => x.id === a.id).status, 'confirmed', 'the cancel was not applied either');
});

test('undo restores the diary exactly as it was', () => {
  const h = createHistory(fresh());
  const before = h.state;
  const b = activeBookings(before, addDays(TODAY, 1))[0];
  const r = h.commit({ type: 'cancel', id: b.id }, 'staff');
  assert.ok(!r.error);
  assert.notEqual(h.state, before);
  h.undo();
  assert.equal(h.state, before);
});

test('every change is written to the activity log with who made it', () => {
  const s = fresh();
  const b = activeBookings(s, addDays(TODAY, 1))[0];
  const r = commit(s, { type: 'cancel', id: b.id, reason: 'Client cancelled' }, 'assistant');
  assert.equal(r.state.log[0].actor, 'assistant');
  assert.match(r.state.log[0].text, /^Cancelled /);
  assert.equal(s.log.length, 0, 'old state untouched');
});
