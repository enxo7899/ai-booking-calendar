// The only way to change the diary. Each action returns a new state (the old one is kept for undo)
// or an error with the guardrail violations. Plans with several moves are all-or-nothing.

import { prepare, idx } from './rules.js';
import { hhmm, prettyDate } from './time.js';

function clone(state) {
  return { ...state, bookings: state.bookings.slice(), absences: state.absences.slice(), waitlist: state.waitlist.slice(), log: state.log.slice() };
}

function logEntry(state, actor, text, kind, extra = {}) {
  state.log.unshift({ id: `l${state.log.length + 1}`, at: `${state.today} ${hhmm(state.nowMinutes)}`, actor, text, kind, ...extra });
}

export function describe(state, b) {
  const I = idx(state);
  return `${I.client[b.clientId].name} · ${I.service[b.serviceId].short} with ${I.staff[b.staffId].first} · ${prettyDate(b.date, state.today)} ${hhmm(b.start)}`;
}

function applyOne(s, action, actor) {
  const I = idx(s);
  switch (action.type) {
    case 'create': {
      const { booking, violations } = prepare(s, { ...action.booking, id: action.booking.id || `b${s.nextId}` });
      if (violations.length) return { error: violations };
      booking.status = booking.status || 'confirmed';
      booking.source = booking.source || actor;
      s.bookings.push(booking);
      s.nextId++;
      if (action.fromWaitlist) s.waitlist = s.waitlist.filter((w) => w.id !== action.fromWaitlist);
      logEntry(s, actor, `Booked ${describe(s, booking)}`, 'create', { bookingId: booking.id });
      return { booking };
    }
    case 'move': {
      const i = s.bookings.findIndex((b) => b.id === action.id);
      if (i < 0) return { error: [{ code: 'UNKNOWN', message: 'Booking not found' }] };
      const before = s.bookings[i];
      const draft = { ...before, ...action.to, end: undefined };
      if (action.to.staffId && action.to.staffId !== before.staffId && !action.to.roomId) draft.roomId = undefined;
      const { booking, violations } = prepare(s, draft, { ignore: action.ignore });
      if (violations.length) return { error: violations };
      s.bookings[i] = booking;
      logEntry(s, actor, `Moved ${I.client[before.clientId].name}: ${prettyDate(before.date, s.today)} ${hhmm(before.start)} ${I.staff[before.staffId].first} → ${prettyDate(booking.date, s.today)} ${hhmm(booking.start)} ${I.staff[booking.staffId].first}`, 'move', { bookingId: booking.id });
      return { booking, before };
    }
    case 'cancel': {
      const i = s.bookings.findIndex((b) => b.id === action.id);
      if (i < 0) return { error: [{ code: 'UNKNOWN', message: 'Booking not found' }] };
      s.bookings[i] = { ...s.bookings[i], status: 'cancelled', cancelReason: action.reason || '' };
      logEntry(s, actor, `Cancelled ${describe(s, s.bookings[i])}${action.reason ? ` (${action.reason})` : ''}`, 'cancel', { bookingId: action.id });
      return { booking: s.bookings[i] };
    }
    case 'confirm': {
      const i = s.bookings.findIndex((b) => b.id === action.id);
      if (i < 0) return { error: [{ code: 'UNKNOWN', message: 'Booking not found' }] };
      s.bookings[i] = { ...s.bookings[i], status: 'confirmed' };
      logEntry(s, actor, `${I.client[s.bookings[i].clientId].name} confirmed ${prettyDate(s.bookings[i].date, s.today)} ${hhmm(s.bookings[i].start)}`, 'confirm', { bookingId: action.id });
      return { booking: s.bookings[i] };
    }
    case 'absence': {
      s.absences.push({ ...action.absence });
      const a = action.absence;
      logEntry(s, actor, `${I.staff[a.staffId].first} marked absent ${prettyDate(a.date, s.today)} ${hhmm(a.start)}–${hhmm(a.end)} (${a.reason})`, 'absence');
      return {};
    }
    case 'waitlist': {
      const w = { id: `w${Date.now() % 100000}${s.waitlist.length}`, ...action.entry };
      s.waitlist.push(w);
      logEntry(s, actor, `Added ${I.client[w.clientId].name} to the waitlist for ${I.service[w.serviceId].short.toLowerCase()}`, 'waitlist');
      return { entry: w };
    }
    default:
      return { error: [{ code: 'UNKNOWN', message: `Unknown action ${action.type}` }] };
  }
}

export function commit(state, action, actor = 'staff') {
  const s = clone(state);
  if (action.type === 'plan') {
    // All-or-nothing: free every booking the plan touches first, then place them one by one.
    const results = [];
    for (const step of action.steps) {
      const r = applyOne(s, step, actor);
      if (r.error) return { state, error: r.error, failedStep: step };
      results.push(r);
    }
    if (action.note) logEntry(s, actor, action.note, 'plan');
    return { state: s, results };
  }
  const r = applyOne(s, action, actor);
  if (r.error) return { state, error: r.error };
  return { state: s, ...r };
}

// Undo history lives outside the state so a plan of ten moves undoes in one step.
export function createHistory(initial) {
  const past = [];
  let current = initial;
  return {
    get state() { return current; },
    commit(action, actor) {
      const r = commit(current, action, actor);
      if (!r.error) { past.push(current); current = r.state; }
      return r;
    },
    replace(next) { past.push(current); current = next; },
    undo() { if (past.length) current = past.pop(); return current; },
    get canUndo() { return past.length > 0; },
  };
}
