// Smart rescheduling. When a therapist calls in sick (or a room floods), every affected client
// needs a new slot. The planner looks for the set of moves that disturbs clients least, as a
// whole, instead of handing out slots first-come-first-served.
//
// Cost of one move (lower is better):
//   same day      |minutes moved| / 60
//   another day   3 + days moved + |change in time of day| / 120
//   therapist     0 same person · 0.5 the client's usual therapist · 1.5 someone new
//   time of day   +0.75 outside the client's preferred part of the day
// Nobody is ever dropped silently: a client with no safe option gets a "call them" task and a
// priority place on the waitlist.

import { idx, prepare, shiftFor, activeBookings } from './rules.js';
import { addDays, daysBetween, dateRange, overlaps, hhmm, prettyDate, fmt12 } from './time.js';
import { resolveWindow } from './slots.js';

const HORIZON_DAYS = 7;

export function moveCost(state, orig, cand) {
  const I = idx(state);
  const client = I.client[orig.clientId];
  const days = daysBetween(orig.date, cand.date);
  let time = days === 0 ? Math.abs(cand.start - orig.start) / 60 : 3 + Math.abs(days) + Math.abs(cand.start - orig.start) / 120;
  if (days < 0) time += 2; // pulling someone earlier by days is harder for them than pushing later
  const staff = cand.staffId === orig.staffId ? 0 : cand.staffId === client.prefers?.staff ? 0.5 : 1.5;
  const win = resolveWindow(client.prefers?.window);
  const pref = win && !(cand.start >= win[0] && cand.start < win[1]) ? 0.75 : 0;
  return Math.round((time + staff + pref) * 100) / 100;
}

function withBookings(state, bookings) {
  return { ...state, bookings };
}

// Every safe new slot for one booking, cheapest first.
function options(state, base, orig, limit = 14, ripple = null) {
  const I = idx(state);
  const service = I.service[orig.serviceId];
  const scratch = withBookings(state, base);
  const out = [];
  const pool = state.catalog.staff.filter((s) => s.skills.includes(service.skill));
  for (const date of dateRange(orig.date < state.today ? state.today : orig.date, addDays(orig.date, HORIZON_DAYS))) {
    for (const person of pool) {
      const shift = shiftFor(state, person.id, date);
      if (!shift) continue;
      for (let start = shift.start; start + service.minutes <= shift.end; start += state.catalog.studio.slotStep) {
        const { booking, violations } = prepare(scratch, { ...orig, id: orig.id, date, start, staffId: person.id, end: undefined, roomId: undefined });
        if (violations.length) continue;
        out.push({ booking, cost: moveCost(state, orig, booking) });
      }
    }
  }
  if (ripple) out.push(...rippleOptions(state, base, orig, ripple));
  out.sort((a, b) => a.cost - b.cost);
  return out.slice(0, limit);
}

// Ripple moves: a client who agreed to be flexible can shift up to 90 minutes on the same day,
// with the same therapist, if that lets an affected client keep their day and time.
// Each ripple costs the flexible client 0.6 + 0.8 per hour shifted, so it is only used when it
// clearly helps.
const RIPPLE_SHIFTS = [15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90];
function rippleOptions(state, base, orig, ctx) {
  const I = idx(state);
  const service = I.service[orig.serviceId];
  const out = [];
  if (orig.date < state.today) return out;
  for (const person of state.catalog.staff.filter((s) => s.skills.includes(service.skill) && s.id !== orig.staffId)) {
    for (let delta = -60; delta <= 60; delta += 15) {
      const start = orig.start + delta;
      const draft = { ...orig, staffId: person.id, start, end: start + service.minutes, roomId: undefined };
      const blockers = base.filter((o) => o.status !== 'cancelled' && o.date === orig.date && o.staffId === person.id && overlaps(o.start, o.end + (I.service[o.serviceId].buffer || 0), draft.start, draft.end + (service.buffer || 0)));
      if (blockers.length !== 1) continue;
      const blocker = blockers[0];
      if (!I.client[blocker.clientId].flexible || ctx.locked.has(blocker.id)) continue;
      const without = base.filter((o) => o.id !== blocker.id);
      const placed = prepare(withBookings(state, without), draft);
      if (placed.violations.length) continue;
      const withNew = withBookings(state, without.concat([placed.booking]));
      for (const shift of RIPPLE_SHIFTS) {
        const moved = prepare(withNew, { ...blocker, start: blocker.start + shift, end: undefined, roomId: blocker.roomId });
        if (moved.violations.length) continue;
        const cost = moveCost(state, orig, placed.booking) + 0.6 + (Math.abs(shift) / 60) * 0.8;
        out.push({ booking: placed.booking, cost: Math.round(cost * 100) / 100, ripple: { orig: blocker, next: moved.booking, shift } });
        break;
      }
    }
  }
  return out;
}

export function affectedBy(state, disruption) {
  return activeBookings(state, disruption.date).filter((b) => {
    if (!overlaps(b.start, b.end, disruption.start, disruption.end)) return false;
    // A session already under way is left alone; the absence starts after it.
    if (b.date === state.today && b.start < state.nowMinutes) return false;
    if (disruption.staffId) return b.staffId === disruption.staffId;
    if (disruption.roomId) return b.roomId === disruption.roomId;
    return false;
  });
}

// disruption: { staffId?, roomId?, date, start, end, reason }
// Returns { plan steps, rows for the UI, totals } without changing anything.
export function planRepair(state, disruption, { strategy = 'optimal', beam = 8, branch = 4 } = {}) {
  const I = idx(state);
  const blocked = { ...state, absences: [...state.absences] };
  if (disruption.staffId) blocked.absences.push({ staffId: disruption.staffId, date: disruption.date, start: disruption.start, end: disruption.end, reason: disruption.reason });
  const affected = affectedBy(state, disruption);
  const affectedIds = new Set(affected.map((b) => b.id));
  const base = state.bookings.filter((b) => !affectedIds.has(b.id));
  // A room closure is modelled as a booking-shaped block on that room.
  if (disruption.roomId) base.push({ id: '__closure', clientId: state.catalog.clients[0].id, serviceId: state.catalog.services[0].id, staffId: '__none', roomId: disruption.roomId, date: disruption.date, start: disruption.start, end: disruption.end, status: 'block' });
  const ctx = disruption.roomId ? { ...blocked, catalog: blocked.catalog } : blocked;

  let chosen;
  if (strategy === 'naive') chosen = naive(ctx, base, affected);
  else {
    chosen = beamSearch(ctx, base, affected, beam, branch, strategy !== 'no-ripple');
    // Beam search is a heuristic. Also score the simple baseline and keep whichever is better,
    // so the planner is never worse than "first free slot" on its own measure.
    const fallback = naive(ctx, base, affected);
    const total = (m) => affected.reduce((t, b) => t + (m.has(b.id) ? m.get(b.id).cost : 25), 0);
    if (total(fallback) < total(chosen)) chosen = fallback;
  }

  const rows = affected.map((orig) => {
    const pick = chosen.get(orig.id);
    const row = { orig, next: pick ? pick.booking : null, cost: pick ? pick.cost : null, message: draftMessage(state, orig, pick ? pick.booking : null, disruption) };
    if (pick?.ripple) row.ripple = { ...pick.ripple, message: rippleMessage(state, pick.ripple) };
    return row;
  });

  const steps = [];
  if (disruption.staffId) steps.push({ type: 'absence', absence: { staffId: disruption.staffId, date: disruption.date, start: disruption.start, end: disruption.end, reason: disruption.reason } });
  const order = rows.filter((r) => r.next);
  order.forEach((r, i) => {
    const later = order.slice(i + 1).map((x) => x.orig.id);
    if (r.ripple) steps.push({ type: 'move', id: r.ripple.orig.id, to: { start: r.ripple.next.start, roomId: r.ripple.next.roomId, status: 'pending', movedFrom: { date: r.ripple.orig.date, start: r.ripple.orig.start, staffId: r.ripple.orig.staffId } }, ignore: order.slice(i).map((x) => x.orig.id) });
    steps.push({ type: 'move', id: r.orig.id, to: { date: r.next.date, start: r.next.start, staffId: r.next.staffId, roomId: r.next.roomId, status: 'pending', movedFrom: { date: r.orig.date, start: r.orig.start, staffId: r.orig.staffId } }, ignore: later.concat(rows.filter((x) => !x.next).map((x) => x.orig.id)) });
  });
  for (const r of rows.filter((x) => !x.next)) {
    steps.push({ type: 'cancel', id: r.orig.id, reason: `${disruption.reason}: no safe slot within ${HORIZON_DAYS} days, call the client` });
    steps.push({ type: 'waitlist', entry: { clientId: r.orig.clientId, serviceId: r.orig.serviceId, staffId: r.orig.staffId, window: 'any', from: state.today, to: addDays(state.today, 13), priority: true, added: state.today } });
  }
  return { disruption, rows, steps, totals: totals(state, rows) };
}

export function totals(state, rows) {
  const I = idx(state);
  const placed = rows.filter((r) => r.next);
  const sum = (f) => placed.reduce((s, r) => s + f(r), 0);
  return {
    affected: rows.length,
    rehoused: placed.length,
    unresolved: rows.length - placed.length,
    sameTime: placed.filter((r) => r.next.date === r.orig.date && r.next.start === r.orig.start).length,
    sameDay: placed.filter((r) => r.next.date === r.orig.date).length,
    usualTherapist: placed.filter((r) => r.next.staffId === r.orig.staffId || r.next.staffId === I.client[r.orig.clientId].prefers?.staff).length,
    hoursMoved: Math.round(sum((r) => Math.abs(daysBetween(r.orig.date, r.next.date) * 24 * 60 + r.next.start - r.orig.start) / 60) * 10) / 10,
    flexibleShifts: placed.filter((r) => r.ripple).length,
    within2Days: placed.filter((r) => Math.abs(daysBetween(r.orig.date, r.next.date)) <= 2).length,
    cost: Math.round((sum((r) => r.cost) + (rows.length - placed.length) * 25) * 100) / 100,
  };
}

// Baseline: what a busy receptionist does. In diary order, give each client the first free slot
// from their original time onwards, with whoever can do it.
function naive(state, base, affected) {
  const chosen = new Map();
  let current = base.slice();
  for (const orig of affected.slice().sort((a, b) => a.start - b.start)) {
    const scratch = withBookings(state, current);
    let found = null;
    const service = idx(state).service[orig.serviceId];
    outer: for (const date of dateRange(orig.date, addDays(orig.date, HORIZON_DAYS))) {
      const starts = [];
      for (let t = date === orig.date ? orig.start : 8 * 60; t <= 20 * 60 - service.minutes; t += 15) starts.push(t);
      for (const start of starts) {
        for (const person of state.catalog.staff.filter((s) => s.skills.includes(service.skill))) {
          const { booking, violations } = prepare(scratch, { ...orig, date, start, staffId: person.id, end: undefined, roomId: undefined });
          if (!violations.length) { found = booking; break outer; }
        }
      }
    }
    if (found) {
      chosen.set(orig.id, { booking: found, cost: moveCost(state, orig, found) });
      current = current.concat([found]);
    }
  }
  return chosen;
}

// Beam search over the affected bookings, hardest to place first. Each partial plan keeps the
// bookings it has placed so later choices are checked against them.
function beamSearch(state, base, affected, width, branch, allowRipple = true) {
  const withOpts = affected.map((b) => ({ b, opts: options(state, base, b) }));
  withOpts.sort((x, y) => x.opts.length - y.opts.length || (x.opts[0]?.cost ?? 99) - (y.opts[0]?.cost ?? 99));
  let beams = [{ current: base, picks: new Map(), locked: new Set(), cost: 0 }];
  for (const { b } of withOpts) {
    const next = [];
    for (const beamState of beams) {
      const opts = options(state, beamState.current, b, branch, allowRipple ? { locked: beamState.locked } : null);
      if (!opts.length) {
        next.push({ ...beamState, cost: beamState.cost + 25 });
        continue;
      }
      for (const o of opts) {
        const picks = new Map(beamState.picks);
        picks.set(b.id, o);
        let current = beamState.current;
        const locked = new Set(beamState.locked);
        if (o.ripple) {
          current = current.filter((x) => x.id !== o.ripple.orig.id).concat([o.ripple.next]);
          locked.add(o.ripple.orig.id);
        }
        next.push({ current: current.concat([o.booking]), picks, locked, cost: beamState.cost + o.cost });
      }
    }
    next.sort((x, y) => x.cost - y.cost);
    beams = next.slice(0, width);
  }
  return beams[0].picks;
}

export function draftMessage(state, orig, next, disruption) {
  const I = idx(state);
  const client = I.client[orig.clientId];
  const first = client.name.split(' ')[0];
  const service = I.service[orig.serviceId].name.toLowerCase();
  const why = disruption.staffId ? `${I.staff[disruption.staffId].first} is ${/sick|ill|unwell/i.test(disruption.reason) ? 'unwell' : 'unavailable'}` : `${I.room[disruption.roomId]?.name || 'a room'} is closed`;
  const day = (d) => {
    const p = prettyDate(d, state.today);
    return p === 'Today' || p === 'Tomorrow' ? p.toLowerCase() : `on ${p}`;
  };
  const when = `${day(orig.date)} at ${fmt12(orig.start)}`;
  if (!next) return `Hi ${first}, ${why}, so we can't see you for your ${service} ${when}, and we have no good slot this week. We'll call you today to find a time that suits you. Sorry for the trouble. Lëvizja`;
  const sameTime = next.date === orig.date && next.start === orig.start;
  const who = I.staff[next.staffId].first;
  const body = sameTime
    ? `${who} can see you at the same time instead`
    : `we've held ${day(next.date)} at ${fmt12(next.start)} with ${next.staffId === orig.staffId ? `${who} as usual` : who} for you`;
  return `Hi ${first}, ${why}, so your ${service} ${when} has to change: ${body}. Reply YES to confirm or OTHER for different times. Lëvizja`;
}

function rippleMessage(state, rp) {
  const I = idx(state);
  const first = I.client[rp.orig.clientId].name.split(' ')[0];
  const p = prettyDate(rp.orig.date, state.today);
  const day = p === 'Today' || p === 'Tomorrow' ? p.toLowerCase() : `on ${p}`;
  return `Hi ${first}, you said you're happy to be flexible: could your ${I.service[rp.orig.serviceId].name.toLowerCase()} ${day} move from ${fmt12(rp.orig.start)} to ${fmt12(rp.next.start)}? It helps us look after a client whose therapist is off. Reply YES or NO, no problem either way. Lëvizja`;
}

export function rowLabel(state, b) {
  const I = idx(state);
  return `${hhmm(b.start)} ${I.staff[b.staffId].first}`;
}
