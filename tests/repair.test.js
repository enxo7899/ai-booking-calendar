import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRepair } from '../src/repair.js';
import { commit } from '../src/store.js';
import { checkBooking, idx } from '../src/rules.js';
import { seedState } from '../src/seed.js';
import { fresh, TODAY } from './helpers.js';
import { addDays } from '../src/time.js';

const sick = (staffId, date) => ({ staffId, date, start: 0, end: 24 * 60, reason: 'Off sick' });

test('a sick-day plan rehouses or flags every affected client and breaks no rule', () => {
  for (const seed of [3, 7, 11]) {
    const s = seedState({ today: TODAY, nowMinutes: 7 * 60, seed });
    for (const staffId of ['elira', 'arben', 'marco']) {
      const plan = planRepair(s, sick(staffId, TODAY));
      const r = commit(s, { type: 'plan', steps: plan.steps });
      assert.ok(!r.error, JSON.stringify(r.error));
      for (const row of plan.rows) {
        const after = r.state.bookings.find((b) => b.id === row.orig.id);
        if (row.next) {
          assert.notEqual(after.staffId === staffId && after.date === TODAY, true, 'nobody stays with the absent therapist');
          assert.deepEqual(checkBooking(r.state, after, { skipTime: true }), []);
        } else {
          assert.equal(after.status, 'cancelled');
          assert.ok(r.state.waitlist.some((w) => w.clientId === row.orig.clientId && w.priority), 'unplaced client goes to the top of the waitlist');
        }
      }
    }
  }
});

test('a session already under way is not moved', () => {
  const s = fresh(); // 09:40
  const running = s.bookings.find((b) => b.date === TODAY && b.start < 9 * 60 + 40 && b.end > 9 * 60 + 40);
  assert.ok(running, 'fixture has a session in progress');
  const plan = planRepair(s, { ...sick(running.staffId, TODAY), start: 9 * 60 + 40 });
  assert.ok(!plan.rows.some((r) => r.orig.id === running.id));
});

test('the planner never does worse than "first free slot" on its own score', () => {
  let ours = 0;
  let naive = 0;
  for (const seed of [21, 22, 23, 24]) {
    const s = seedState({ today: TODAY, nowMinutes: 7 * 60, seed });
    for (const staffId of ['elira', 'arben', 'marco', 'sara']) {
      const d = sick(staffId, addDays(TODAY, 1));
      const a = planRepair(s, d).totals.cost;
      const b = planRepair(s, d, { strategy: 'naive' }).totals.cost;
      assert.ok(a <= b + 1e-9, `seed ${seed} ${staffId}: ${a} > ${b}`);
      ours += a;
      naive += b;
    }
  }
  assert.ok(ours < naive);
});

test('only clients who agreed to be flexible are ever asked to shift', () => {
  for (const seed of [100, 103, 107, 111, 116]) {
    const s = seedState({ today: TODAY, nowMinutes: 7 * 60, seed });
    for (const staffId of ['elira', 'arben', 'jona']) {
      const plan = planRepair(s, sick(staffId, TODAY));
      for (const row of plan.rows.filter((r) => r.ripple)) {
        assert.equal(idx(s).client[row.ripple.orig.clientId].flexible, true);
        assert.equal(row.ripple.next.staffId, row.ripple.orig.staffId, 'same therapist');
        assert.equal(row.ripple.next.date, row.ripple.orig.date, 'same day');
      }
    }
  }
});

test('every affected client gets a drafted message that names the new time', () => {
  const s = fresh();
  const plan = planRepair(s, sick('arben', addDays(TODAY, 1)));
  assert.ok(plan.rows.length > 0);
  for (const row of plan.rows) {
    assert.match(row.message, /^Hi \w+/);
    if (row.next) assert.match(row.message, /Reply YES/);
    else assert.match(row.message, /call you/);
  }
});
