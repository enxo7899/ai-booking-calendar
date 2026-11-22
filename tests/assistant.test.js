import { test } from 'node:test';
import assert from 'node:assert/strict';
import { respond } from '../src/assistant.js';
import { parseCommand } from '../src/nlp.js';
import { checkBooking } from '../src/rules.js';
import { findSlots } from '../src/slots.js';
import { fresh, TODAY } from './helpers.js';
import { addDays } from '../src/time.js';

test('"next Tuesday" means the Tuesday of next week, "Friday" the coming Friday', () => {
  const s = fresh(); // Tuesday 24 Nov
  assert.equal(parseCommand('book Tom next Tuesday at 6pm', s).when.date, '2026-12-01');
  assert.equal(parseCommand('book Tom on Friday', s).when.date, '2026-11-27');
  assert.equal(parseCommand('book Tom tomorrow', s).when.date, '2026-11-25');
});

test('a bare "at 3" means 3pm in a studio open 8am to 8pm', () => {
  assert.equal(parseCommand('book Klajdi Friday at 3', fresh()).when.time, 15 * 60);
  assert.equal(parseCommand('book Klajdi Friday at 9', fresh()).when.time, 9 * 60);
});

test('an ambiguous first name gets a question, never a guess', () => {
  const r = respond(fresh(), 'Ana needs a follow-up tomorrow morning');
  assert.equal(r.kind, 'clarify');
  assert.deepEqual(r.choices.map((c) => c.clientId).sort(), ['c01', 'c02']);
});

test('Albanian and Italian requests are understood', () => {
  const sq = parseCommand('Rezervo Besa për pilates nesër në 10', fresh());
  assert.equal(sq.intent, 'book');
  assert.equal(sq.client, 'c05');
  assert.equal(sq.when.date, addDays(TODAY, 1));
  assert.equal(sq.when.time, 10 * 60);
  const it = parseCommand('Prenota Francesca per pilates domani alle 9', fresh());
  assert.equal(it.client, 'c13');
  assert.equal(it.when.time, 9 * 60);
});

test('the assistant only proposes: asking it never changes the diary', () => {
  const s = fresh();
  const snapshot = JSON.stringify(s.bookings);
  for (const q of ['Arben called in sick today', 'Cancel Giulia\'s next reformer session', 'Book Dritan with Arben tomorrow after 5pm', 'Fill the gaps tomorrow']) respond(s, q);
  assert.equal(JSON.stringify(s.bookings), snapshot);
});

test('every slot the assistant suggests passes the guardrails', () => {
  const s = fresh();
  for (const q of ['Book Dritan for dry needling with Arben this week', 'When can Marco do a sports massage this week?', 'Book Besa for reformer next week']) {
    const r = respond(s, q);
    for (const p of r.proposals || []) assert.deepEqual(checkBooking(s, p.booking), [], `${q}: ${JSON.stringify(p.booking)}`);
  }
});

test('the client\'s usual therapist and preferred time of day rank higher', () => {
  const s = fresh();
  // Dritan prefers Arben in the evening.
  const slots = findSlots(s, { clientId: 'c03', serviceId: 'followup', dateFrom: addDays(TODAY, 1), dateTo: addDays(TODAY, 7), limit: 3 });
  assert.equal(slots[0].booking.staffId, 'arben');
  assert.ok(slots[0].booking.start >= 17 * 60);
});

test('asking for an unqualified therapist explains who can do it', () => {
  const r = respond(fresh(), 'Book Ana Berisha with Marco for physio tomorrow at 10');
  assert.equal(r.kind, 'blocked');
  assert.match(r.say, /Elira|Arben|Jona/);
});

test('a time that is already taken is refused with the reason and safe alternatives', () => {
  const s = fresh();
  const taken = s.bookings.find((b) => b.date === addDays(TODAY, 1) && b.staffId === 'elira');
  const r = respond(s, `Book Tom Walsh for a follow-up with Elira tomorrow at ${String(Math.floor(taken.start / 60)).padStart(2, '0')}:${String(taken.start % 60).padStart(2, '0')}`);
  assert.equal(r.kind, 'blocked');
  assert.ok(r.violations.some((v) => v.code === 'STAFF_CLASH'));
  for (const p of r.proposals) assert.deepEqual(checkBooking(s, p.booking), []);
});

test('ids the AI layer invents are dropped, so the app asks instead of acting', async () => {
  const { sanitizeIntent } = await import('../src/intent-schema.js');
  const s = fresh();
  const out = sanitizeIntent({ intent: 'book', client_id: 'c999', staff_id: 'dr_who', service_id: 'botox', confidence: 0.9 }, s.catalog);
  assert.equal(out.client_id, null);
  assert.equal(out.staff_id, null);
  assert.equal(out.service_id, null);
});
