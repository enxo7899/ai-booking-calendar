// Finding and ranking free slots. Hard rules come from rules.js; this file only decides which of
// the safe slots is best, and says why in plain words.

import { idx, prepare, shiftFor, activeBookings } from './rules.js';
import { addDays, daysBetween, dateRange, hhmm } from './time.js';
import { windows } from '../data/studio.js';

export const DEAD_GAP = 30; // a free gap shorter than the shortest service can't be sold

// Free intervals in a staff member's day, after breaks, absences and bookings (with clean-up).
export function freeIntervals(state, staffId, date, opts = {}) {
  const shift = shiftFor(state, staffId, date);
  if (!shift) return [];
  const I = idx(state);
  const ignore = new Set(opts.ignore || []);
  const busy = [
    ...shift.breaks,
    ...(state.absences || []).filter((a) => a.staffId === staffId && a.date === date).map((a) => ({ start: a.start, end: a.end })),
    ...activeBookings(state, date)
      .filter((b) => b.staffId === staffId && !ignore.has(b.id))
      .map((b) => ({ start: b.start, end: b.end + (I.service[b.serviceId].buffer || 0) })),
    ...(opts.extra || []),
  ].sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = shift.start;
  for (const x of busy) {
    if (x.start > cursor) out.push({ start: cursor, end: Math.min(x.start, shift.end) });
    cursor = Math.max(cursor, x.end);
  }
  if (cursor < shift.end) out.push({ start: cursor, end: shift.end });
  return out.filter((g) => g.end > g.start);
}

export function deadMinutes(state, staffId, date, opts) {
  return freeIntervals(state, staffId, date, opts)
    .filter((g) => g.end - g.start < DEAD_GAP)
    .reduce((s, g) => s + (g.end - g.start), 0);
}

export function resolveWindow(w) {
  if (!w) return null;
  if (Array.isArray(w)) return w;
  return windows[w] || null;
}

// req: { clientId, serviceId, staffId?, dateFrom, dateTo, window?, after?, before?, limit?, ignore?, anchor? }
// anchor: { date, start } of an existing booking; slots close to it score higher (used for moves).
export function findSlots(state, req) {
  const I = idx(state);
  const service = I.service[req.serviceId];
  const client = I.client[req.clientId];
  if (!service || !client) return [];
  const step = state.catalog.studio.slotStep;
  const from = req.dateFrom || state.today;
  const to = req.dateTo || addDays(from, 6);
  const win = resolveWindow(req.window);
  const prefWin = resolveWindow(client.prefers?.window);
  const staffPool = state.catalog.staff.filter((s) => s.skills.includes(service.skill) && (!req.staffId || s.id === req.staffId));
  const span = Math.max(1, daysBetween(from, to) + 1);
  const results = [];

  for (const date of dateRange(from, to)) {
    for (const person of staffPool) {
      const shift = shiftFor(state, person.id, date);
      if (!shift) continue;
      const deadBefore = deadMinutes(state, person.id, date, { ignore: req.ignore });
      const load = activeBookings(state, date).filter((b) => b.staffId === person.id && !(req.ignore || []).includes(b.id)).reduce((s, b) => s + b.end - b.start, 0);
      for (let start = shift.start; start + service.minutes <= shift.end; start += step) {
        if (win && (start < win[0] || start >= win[1])) continue;
        if (req.after != null && start < req.after) continue;
        if (req.before != null && start + service.minutes > req.before) continue;
        const { booking, violations } = prepare(state, { clientId: client.id, serviceId: service.id, staffId: person.id, date, start }, { ignore: req.ignore });
        if (violations.length) continue;
        const deadAfter = deadMinutes(state, person.id, date, { ignore: req.ignore, extra: [{ start, end: booking.end + (service.buffer || 0) }] });
        results.push(score(state, { booking, person, client, service, date, start, from, span, prefWin, deadBefore, deadAfter, load, anchor: req.anchor, requestedStaff: req.staffId }));
      }
    }
  }
  results.sort((a, b) => b.score - a.score || a.booking.date.localeCompare(b.booking.date) || a.booking.start - b.booking.start);
  return diversify(results, req.limit || 5);
}

function score(state, x) {
  const parts = [];
  const prefStaff = x.client.prefers?.staff;
  const staffFit = x.requestedStaff ? 1 : prefStaff === x.person.id ? 1 : 0.35;
  parts.push({ key: 'fit', label: x.requestedStaff ? `${x.person.first}, as asked` : prefStaff === x.person.id ? `${x.person.first} is their usual therapist` : `Not their usual therapist`, weight: 30, value: staffFit });

  const inPref = x.prefWin ? x.start >= x.prefWin[0] && x.start < x.prefWin[1] : true;
  parts.push({ key: 'time', label: inPref ? `Matches their ${x.client.prefers?.window || 'preferred'} preference` : `Outside their usual ${x.client.prefers?.window || ''} time`, weight: 20, value: inPref ? 1 : 0.2 });

  let soonValue;
  let soonLabel;
  if (x.anchor) {
    const shiftMin = Math.abs(daysBetween(x.anchor.date, x.date) * 24 * 60 + (x.start - x.anchor.start));
    soonValue = Math.max(0, 1 - shiftMin / (3 * 24 * 60));
    soonLabel = shiftMin === 0 ? 'Same time as before' : `${shiftMin < 24 * 60 ? `${Math.round(shiftMin / 6) / 10} h` : `${Math.round(shiftMin / 144) / 10} days`} from the original time`;
  } else {
    const off = daysBetween(x.from, x.date);
    soonValue = 1 - off / x.span;
    soonLabel = off === 0 ? 'Earliest day in range' : `${off} day${off === 1 ? '' : 's'} into the range`;
  }
  parts.push({ key: 'soon', label: soonLabel, weight: 20, value: soonValue });

  const saved = x.deadBefore - x.deadAfter;
  const created = x.deadAfter - x.deadBefore;
  const tidyValue = created > 0 ? Math.max(0, 0.4 - created / 60) : Math.min(1, 0.6 + saved / 45);
  parts.push({ key: 'tidy', label: created > 0 ? `Leaves ${created} min of unsellable gap` : saved > 0 ? `Fills a ${saved} min gap nobody could book` : 'Keeps the day compact', weight: 20, value: tidyValue });

  const balance = 1 - x.load / x.person.maxDailyMinutes;
  parts.push({ key: 'load', label: `${x.person.first} is ${Math.round((x.load / x.person.maxDailyMinutes) * 100)}% booked that day`, weight: 10, value: balance });

  const total = parts.reduce((s, p) => s + p.weight * p.value, 0);
  return { booking: x.booking, score: Math.round(total), parts, label: `${hhmm(x.start)} with ${x.person.first}` };
}

// Don't offer five slots that are all Tuesday with Elira: cap two per staff-day, keep order.
function diversify(sorted, limit) {
  const out = [];
  const seen = new Map();
  for (const r of sorted) {
    const k = r.booking.staffId + r.booking.date;
    const n = seen.get(k) || 0;
    if (n >= 2) continue;
    if (out.some((o) => o.booking.staffId === r.booking.staffId && o.booking.date === r.booking.date && Math.abs(o.booking.start - r.booking.start) < 60)) continue;
    seen.set(k, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// Utilisation and unsellable time per staff member for one day (the numbers on the side rail).
export function dayStats(state, date) {
  const rows = state.catalog.staff.map((s) => {
    const shift = shiftFor(state, s.id, date);
    if (!shift) return { staffId: s.id, working: false };
    const absent = (state.absences || []).filter((a) => a.staffId === s.id && a.date === date).reduce((t, a) => t + a.end - a.start, 0);
    const brk = shift.breaks.reduce((t, b) => t + b.end - b.start, 0);
    const capacity = Math.max(0, shift.end - shift.start - brk - absent);
    const booked = activeBookings(state, date).filter((b) => b.staffId === s.id).reduce((t, b) => t + b.end - b.start, 0);
    return { staffId: s.id, working: capacity > 0, capacity, booked, dead: deadMinutes(state, s.id, date), utilisation: capacity ? booked / capacity : 0 };
  });
  const cap = rows.reduce((t, r) => t + (r.capacity || 0), 0);
  const booked = rows.reduce((t, r) => t + (r.booked || 0), 0);
  const revenue = activeBookings(state, date).reduce((t, b) => t + idx(state).service[b.serviceId].price, 0);
  return { rows, utilisation: cap ? booked / cap : 0, dead: rows.reduce((t, r) => t + (r.dead || 0), 0), revenue, count: activeBookings(state, date).length };
}
