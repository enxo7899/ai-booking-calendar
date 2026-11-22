import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBooking, prepare } from '../src/rules.js';
import { commit } from '../src/store.js';
import { empty, fresh, TODAY } from './helpers.js';
import { addDays } from '../src/time.js';

const TOMORROW = addDays(TODAY, 1); // Wednesday
const codes = (v) => v.map((x) => x.code);
const at = (h, m = 0) => h * 60 + m;

function place(state, draft) {
  const r = commit(state, { type: 'create', booking: draft });
  assert.ok(!r.error, `setup booking should be valid: ${JSON.stringify(r.error)}`);
  return r.state;
}

test('a therapist can never be double-booked', () => {
  let s = place(empty(), { clientId: 'c01', serviceId: 'followup', staffId: 'elira', date: TOMORROW, start: at(10) });
  const { violations } = prepare(s, { clientId: 'c08', serviceId: 'followup', staffId: 'elira', date: TOMORROW, start: at(10, 30) });
  assert.ok(codes(violations).includes('STAFF_CLASH'));
  const r = commit(s, { type: 'create', booking: { clientId: 'c08', serviceId: 'followup', staffId: 'elira', date: TOMORROW, start: at(10, 30) } });
  assert.ok(r.error, 'store refuses the double booking');
  assert.equal(r.state.bookings.length, 1, 'diary unchanged');
});

test('clean-up time between two uses of a room is respected', () => {
  // Massage has 15 minutes of clean-up: Garden room is busy until 11:15.
  let s = place(empty(), { clientId: 'c04', serviceId: 'massage', staffId: 'marco', roomId: 'm1', date: TOMORROW, start: at(10) });
  const tooSoon = checkBooking(s, { clientId: 'c11', serviceId: 'lymph', staffId: 'elira', roomId: 'm1', date: TOMORROW, start: at(11, 5), end: at(11, 50) });
  assert.ok(codes(tooSoon).includes('ROOM_CLASH'));
  const ok = checkBooking(s, { clientId: 'c11', serviceId: 'lymph', staffId: 'elira', roomId: 'm1', date: TOMORROW, start: at(11, 15), end: at(12) });
  assert.deepEqual(codes(ok), []);
});

test('only qualified staff can be booked for a service', () => {
  const { violations } = prepare(empty(), { clientId: 'c01', serviceId: 'followup', staffId: 'marco', date: TOMORROW, start: at(11) });
  assert.ok(codes(violations).includes('NOT_QUALIFIED'), 'a massage therapist cannot do physio');
});

test('the single shockwave unit cannot be used by two therapists at once', () => {
  let s = place(empty(), { clientId: 'c08', serviceId: 'shockwave', staffId: 'elira', date: TOMORROW, start: at(13) });
  const { violations } = prepare(s, { clientId: 'c42', serviceId: 'shockwave', staffId: 'arben', date: TOMORROW, start: at(13, 15) });
  assert.ok(codes(violations).includes('EQUIPMENT_CLASH'));
});

test('nothing is booked during a protected break or outside a shift', () => {
  const s = empty();
  assert.ok(codes(prepare(s, { clientId: 'c01', serviceId: 'followup', staffId: 'elira', date: TOMORROW, start: at(12, 15) }).violations).includes('ON_BREAK'));
  assert.ok(codes(prepare(s, { clientId: 'c01', serviceId: 'followup', staffId: 'elira', date: TOMORROW, start: at(15, 30) }).violations).includes('STAFF_NOT_WORKING'));
  assert.ok(codes(prepare(s, { clientId: 'c01', serviceId: 'followup', staffId: 'jona', date: addDays(TODAY, 2), start: at(10) }).violations).includes('STAFF_NOT_WORKING'), 'Jona does not work Thursdays');
});

test('nothing is booked in the past or inside the one-hour notice period', () => {
  const s = empty(); // now is 09:40
  assert.ok(codes(prepare(s, { clientId: 'c01', serviceId: 'followup', staffId: 'elira', date: TODAY, start: at(9) }).violations).includes('IN_PAST'));
  assert.ok(codes(prepare(s, { clientId: 'c01', serviceId: 'followup', staffId: 'elira', date: TODAY, start: at(10, 15) }).violations).includes('TOO_SOON'));
  assert.deepEqual(codes(prepare(s, { clientId: 'c01', serviceId: 'followup', staffId: 'elira', date: TODAY, start: at(11) }).violations), []);
});

test('a client cannot be in two appointments at the same time', () => {
  let s = place(empty(), { clientId: 'c01', serviceId: 'followup', staffId: 'elira', date: TOMORROW, start: at(9) });
  const { violations } = prepare(s, { clientId: 'c01', serviceId: 'reformer', staffId: 'sara', date: TOMORROW, start: at(9, 15) });
  assert.ok(codes(violations).includes('CLIENT_CLASH'));
});

test('an appointment of the wrong length is refused', () => {
  const v = checkBooking(empty(), { clientId: 'c01', serviceId: 'followup', staffId: 'elira', roomId: 't1', date: TOMORROW, start: at(9), end: at(10) });
  assert.ok(codes(v).includes('BAD_DURATION'));
});

test('the seeded demo diary passes every guardrail', () => {
  const s = fresh();
  for (const b of s.bookings) assert.deepEqual(codes(checkBooking(s, b, { skipTime: true })), [], `${b.id} should be valid`);
});
