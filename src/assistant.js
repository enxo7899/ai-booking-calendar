// The assistant: sentence → intent → proposals a person can confirm.
// It never writes to the diary itself. Every proposal carries the exact store action that
// Confirm will commit, and that action is checked again by the guardrails at commit time.

import { parseCommand, toIntentJSON, findClientBookings } from './nlp.js';
import { idx, prepare, activeBookings, shiftFor } from './rules.js';
import { findSlots, dayStats, resolveWindow } from './slots.js';
import { planRepair } from './repair.js';
import { addDays, hhmm, prettyDate, fmt12 } from './time.js';
import { describe } from './store.js';

export function respond(state, text, opts = {}) {
  const p = opts.parsed || parseCommand(text, state);
  if (opts.clientOverride) {
    p.client = opts.clientOverride;
    p.clientCandidates = [];
    p.missing = p.missing.filter((m) => m !== 'which_client' && m !== 'client');
    if (p.intent === 'move' || p.intent === 'cancel') {
      p.bookingCandidates = findClientBookings(state, p.client, p.when).map((b) => b.id);
      if (!p.bookingCandidates.length) p.missing.push('booking');
    }
  }
  const intent = toIntentJSON(p);
  const base = { text, intent, parsed: p };
  const I = idx(state);

  if (p.missing.includes('which_client')) {
    return { ...base, kind: 'clarify', say: `Which ${I.client[p.clientCandidates[0]].name.split(' ')[0]} do you mean?`, choices: p.clientCandidates.map((id) => ({ label: I.client[id].name, sub: nextVisitLabel(state, id), clientId: id })) };
  }
  if (!p.intent) {
    return { ...base, kind: 'help', say: "I didn't catch what to do. Try one of these:", examples: EXAMPLES.slice(0, 4) };
  }

  switch (p.intent) {
    case 'book':
      return book(state, p, base);
    case 'find':
      return find(state, p, base);
    case 'move':
      return move(state, p, base);
    case 'cancel':
      return cancel(state, p, base);
    case 'staff_off':
      return staffOff(state, p, base);
    case 'waitlist':
      return waitlist(state, p, base);
    case 'query':
      return query(state, p, base);
    case 'fill_gaps':
      return fillGaps(state, p, base);
    default:
      return { ...base, kind: 'help', say: 'Not sure about that one.', examples: EXAMPLES.slice(0, 4) };
  }
}

export const EXAMPLES = [
  'Book Dritan for dry needling with Arben tomorrow after 5pm',
  'Arben called in sick today',
  'Move Luca to Friday evening',
  'When can Marco do a sports massage this week?',
  'Cancel Giulia\'s next reformer session',
  'Fill the gaps tomorrow from the waitlist',
  'What does Jona have tomorrow?',
  'Ana needs a follow-up tomorrow morning',
  'Rezervo Besa për pilates nesër në 10',
];

function nextVisitLabel(state, clientId) {
  const b = findClientBookings(state, clientId, null)[0];
  if (!b) return 'No upcoming visits';
  const I = idx(state);
  return `Next: ${prettyDate(b.date, state.today)} ${hhmm(b.start)}, ${I.service[b.serviceId].short.toLowerCase()} with ${I.staff[b.staffId].first}`;
}

function rangeFrom(state, when) {
  const from = when?.date && when.date >= state.today ? when.date : state.today;
  const to = when?.dateTo || (when?.date ? when.date : addDays(state.today, 6));
  return { from, to };
}

function slotProposal(state, r, clientId, extra = {}) {
  return { score: r.score, parts: r.parts, booking: r.booking, action: { type: 'create', booking: { ...r.booking, clientId } }, ...extra };
}

function book(state, p, base) {
  const I = idx(state);
  if (!p.client) return { ...base, kind: 'clarify', say: 'Who is the booking for?', choices: [] };
  const client = I.client[p.client];
  const serviceId = p.service || state.catalog.usualService[p.client] || 'followup';
  const service = I.service[serviceId];
  if (p.staff && !I.staff[p.staff].skills.includes(service.skill)) {
    const able = state.catalog.staff.filter((s) => s.skills.includes(service.skill)).map((s) => s.first);
    return { ...base, kind: 'blocked', say: `${I.staff[p.staff].first} doesn't do ${service.name.toLowerCase()}. ${able.join(' or ')} can.`, violations: [{ code: 'NOT_QUALIFIED', message: `${I.staff[p.staff].first} is not qualified for ${service.name}` }] };
  }
  const { from, to } = rangeFrom(state, p.when);
  const used = { service: !p.service ? `${service.name} (their usual)` : service.name };

  if (p.when?.time != null) {
    const date = p.when.date || state.today;
    const staffOrder = p.staff ? [p.staff] : [client.prefers?.staff, ...state.catalog.staff.map((s) => s.id)].filter((x, i, a) => x && a.indexOf(x) === i && I.staff[x].skills.includes(service.skill));
    const tries = staffOrder.map((staffId) => prepare(state, { clientId: client.id, serviceId, staffId, date, start: p.when.time }));
    const ok = tries.find((t) => !t.violations.length);
    const alts = findSlots(state, { clientId: client.id, serviceId, staffId: p.staff, dateFrom: date, dateTo: addDays(date, 2), anchor: { date, start: p.when.time }, limit: 4 });
    if (ok) {
      return { ...base, kind: 'slots', used, say: `${fmt12(p.when.time)} ${prettyDate(date, state.today).toLowerCase()} works with ${I.staff[ok.booking.staffId].first}.`, proposals: [{ booking: ok.booking, score: null, parts: [], action: { type: 'create', booking: ok.booking }, exact: true }, ...alts.filter((a) => !(a.booking.start === ok.booking.start && a.booking.date === ok.booking.date)).slice(0, 2).map((r) => slotProposal(state, r, client.id))] };
    }
    const why = tries[0]?.violations || [];
    return { ...base, kind: 'blocked', used, say: `${fmt12(p.when.time)} ${prettyDate(date, state.today).toLowerCase()} can't be booked${p.staff ? ` with ${I.staff[p.staff].first}` : ''}. Closest safe times:`, violations: why, proposals: alts.map((r) => slotProposal(state, r, client.id)) };
  }

  const win = p.when?.window || null;
  const slots = findSlots(state, { clientId: client.id, serviceId, staffId: p.staff, dateFrom: from, dateTo: to, window: win, after: p.when?.after, before: p.when?.before, limit: 4 });
  if (!slots.length) {
    const wider = findSlots(state, { clientId: client.id, serviceId, staffId: p.staff, dateFrom: from, dateTo: addDays(to, 7), limit: 3 });
    return { ...base, kind: 'blocked', used, say: `Nothing safe ${describeRange(state, from, to, p.when)}. Nearest options, or add ${client.name.split(' ')[0]} to the waitlist:`, violations: [], proposals: wider.map((r) => slotProposal(state, r, client.id)), waitlistAction: { type: 'waitlist', entry: { clientId: client.id, serviceId, staffId: p.staff || null, window: 'any', from, to, added: state.today } } };
  }
  return { ...base, kind: 'slots', used, say: `Best ${slots.length === 1 ? 'slot' : `${slots.length} slots`} for ${client.name} ${describeRange(state, from, to, p.when)}, ranked:`, proposals: slots.map((r) => slotProposal(state, r, client.id)) };
}

function describeRange(state, from, to, when) {
  const part = when?.window ? ` (${hhmm(when.window[0])}–${hhmm(when.window[1])})` : when?.after != null ? ` after ${fmt12(when.after)}` : when?.before != null ? ` before ${fmt12(when.before)}` : '';
  if (from === to) return `${prettyDate(from, state.today).toLowerCase()}${part}`;
  return `${prettyDate(from, state.today).toLowerCase()} to ${prettyDate(to, state.today)}${part}`;
}

function find(state, p, base) {
  const I = idx(state);
  const clientId = p.client || 'new';
  const serviceId = p.service || (p.client && state.catalog.usualService[p.client]) || (p.staff ? state.catalog.services.find((s) => I.staff[p.staff].skills.includes(s.skill)).id : 'followup');
  const { from, to } = rangeFrom(state, p.when);
  const slots = findSlots(state, { clientId, serviceId, staffId: p.staff, dateFrom: from, dateTo: to, window: p.when?.window, after: p.when?.after, before: p.when?.before, limit: 5 });
  const who = p.staff ? I.staff[p.staff].first : 'the team';
  if (!slots.length) return { ...base, kind: 'blocked', say: `${who} has no safe ${I.service[serviceId].name.toLowerCase()} slot ${describeRange(state, from, to, p.when)}.`, violations: [], proposals: [] };
  return { ...base, kind: 'slots', used: { service: I.service[serviceId].name }, say: `${slots.length} open ${I.service[serviceId].short.toLowerCase()} slots for ${who} ${describeRange(state, from, to, p.when)}:${clientId === 'new' ? ' Pick one, then type the client\'s name.' : ''}`, proposals: slots.map((r) => slotProposal(state, r, clientId, { needsClient: clientId === 'new' })) };
}

function move(state, p, base) {
  const I = idx(state);
  if (!p.client) return { ...base, kind: 'clarify', say: 'Whose appointment should I move?', choices: [] };
  const b = state.bookings.find((x) => x.id === (p.bookingCandidates || [])[0]);
  if (!b) return { ...base, kind: 'blocked', say: `${I.client[p.client].name} has no upcoming appointment${p.when?.date ? ` on ${prettyDate(p.when.date, state.today)}` : ''}.`, violations: [] };
  const what = describe(state, b);
  if (p.delta != null) {
    const to = { date: b.date, start: b.start + p.delta };
    const { booking, violations } = prepare(state, { ...b, ...to, end: undefined });
    if (!violations.length) return { ...base, kind: 'single', say: `Move ${what} to ${hhmm(booking.start)}?`, target: b, proposals: [{ booking, action: { type: 'move', id: b.id, to: { ...to, roomId: booking.roomId } } }] };
    const alts = findSlots(state, { clientId: b.clientId, serviceId: b.serviceId, staffId: b.staffId, dateFrom: b.date, dateTo: addDays(b.date, 2), anchor: { date: b.date, start: to.start }, ignore: [b.id], limit: 3 });
    return { ...base, kind: 'blocked', say: `Can't move it to ${hhmm(to.start)}:`, target: b, violations, proposals: alts.map((r) => ({ ...slotProposal(state, r, b.clientId), action: { type: 'move', id: b.id, to: { date: r.booking.date, start: r.booking.start, staffId: r.booking.staffId, roomId: r.booking.roomId } } })) };
  }
  const tgt = p.target || {};
  const staffId = p.staff && p.staff !== b.staffId ? p.staff : p.anyStaff ? undefined : b.staffId;
  if (tgt.time != null && tgt.date) {
    const { booking, violations } = prepare(state, { ...b, date: tgt.date, start: tgt.time, staffId: staffId || b.staffId, end: undefined });
    if (!violations.length) return { ...base, kind: 'single', say: `Move ${what} to ${prettyDate(tgt.date, state.today)} ${hhmm(tgt.time)}?`, target: b, proposals: [{ booking, action: { type: 'move', id: b.id, to: { date: booking.date, start: booking.start, staffId: booking.staffId, roomId: booking.roomId } } }] };
  }
  const from = tgt.date || (b.date > state.today ? state.today : b.date);
  const to = tgt.dateTo || tgt.date || addDays(from, 6);
  let slots = findSlots(state, { clientId: b.clientId, serviceId: b.serviceId, staffId, dateFrom: from, dateTo: to, window: tgt.window, after: tgt.after ?? (tgt.time != null ? tgt.time - 60 : undefined), before: tgt.before ?? (tgt.time != null ? tgt.time + 60 + I.service[b.serviceId].minutes : undefined), ignore: [b.id], anchor: { date: tgt.date || b.date, start: tgt.time ?? b.start }, limit: 4 });
  let note = '';
  if (!slots.length && staffId) {
    slots = findSlots(state, { clientId: b.clientId, serviceId: b.serviceId, dateFrom: from, dateTo: to, window: tgt.window, after: tgt.after, before: tgt.before, ignore: [b.id], anchor: { date: tgt.date || b.date, start: b.start }, limit: 4 });
    note = ` ${I.staff[staffId].first} is full then, so these are with colleagues.`;
  }
  if (!slots.length) return { ...base, kind: 'blocked', say: `No safe slot ${describeRange(state, from, to, tgt)} for ${what}.`, target: b, violations: [] };
  return { ...base, kind: 'slots', say: `Where should ${what} go?${note}`, target: b, proposals: slots.map((r) => ({ ...slotProposal(state, r, b.clientId), action: { type: 'move', id: b.id, to: { date: r.booking.date, start: r.booking.start, staffId: r.booking.staffId, roomId: r.booking.roomId } } })) };
}

function cancel(state, p, base) {
  const I = idx(state);
  if (!p.client) return { ...base, kind: 'clarify', say: 'Whose appointment should I cancel?', choices: [] };
  let list = (p.bookingCandidates || []).map((id) => state.bookings.find((b) => b.id === id));
  if (p.service) list = list.filter((b) => b.serviceId === p.service).concat(list.filter((b) => b.serviceId !== p.service));
  const b = list[0];
  if (!b) return { ...base, kind: 'blocked', say: `${I.client[p.client].name} has no upcoming appointment to cancel.`, violations: [] };
  const offers = waitlistOffers({ ...state, bookings: state.bookings.map((x) => (x.id === b.id ? { ...x, status: 'cancelled' } : x)) }, { date: b.date, start: b.start - 15, end: b.end + 30, excludeClient: b.clientId });
  return { ...base, kind: 'single', say: `Cancel ${describe(state, b)}?`, target: b, proposals: [{ booking: b, action: { type: 'cancel', id: b.id, reason: 'Client cancelled' }, danger: true }], followUp: offers.length ? `${offers.length} on the waitlist could take this slot; I'll offer it after you confirm.` : null };
}

function staffOff(state, p, base) {
  const I = idx(state);
  if (!p.absence?.staffId) return { ...base, kind: 'clarify', say: 'Who is off?', choices: state.catalog.staff.map((s) => ({ label: s.name, staffId: s.id })) };
  const a = p.absence;
  const shift = shiftFor(state, a.staffId, a.date);
  const person = I.staff[a.staffId];
  if (!shift) return { ...base, kind: 'blocked', say: `${person.first} isn't working ${prettyDate(a.date, state.today).toLowerCase()} anyway, so nothing needs to move.`, violations: [] };
  const start = Math.max(a.start, a.date === state.today ? Math.min(state.nowMinutes, shift.end) : 0);
  const disruption = { staffId: a.staffId, date: a.date, start, end: a.end, reason: a.reason };
  const plan = planRepair(state, disruption);
  const naive = planRepair(state, disruption, { strategy: 'naive' });
  const span = a.start <= shift.start && a.end >= shift.end ? 'all day' : `${hhmm(Math.max(a.start, shift.start))}–${hhmm(Math.min(a.end, shift.end))}`;
  if (!plan.rows.length) {
    return { ...base, kind: 'plan', say: `${person.first} has no clients ${prettyDate(a.date, state.today).toLowerCase()} ${span}. I'll just block the time.`, plan, naive, action: { type: 'plan', steps: plan.steps, note: `${person.first} off ${prettyDate(a.date, state.today)} (${a.reason})` } };
  }
  return { ...base, kind: 'plan', say: `${person.first} is out ${prettyDate(a.date, state.today).toLowerCase()} ${span}. ${plan.rows.length} client${plan.rows.length === 1 ? '' : 's'} affected. Here is the least disruptive plan; nothing is sent until you approve.`, plan, naive, action: { type: 'plan', steps: plan.steps, note: `Rescheduled ${plan.totals.rehoused} of ${plan.totals.affected} clients after ${person.first} became unavailable (${a.reason})` } };
}

function waitlist(state, p, base) {
  const I = idx(state);
  if (!p.client) return { ...base, kind: 'clarify', say: 'Who should go on the waitlist?', choices: [] };
  const serviceId = p.service || state.catalog.usualService[p.client];
  const { from, to } = rangeFrom(state, p.when);
  const windowName = p.when?.window ? Object.entries({ morning: [7 * 60 + 30, 12 * 60], afternoon: [12 * 60, 17 * 60], evening: [17 * 60, 20 * 60] }).find(([, w]) => w[0] === p.when.window[0])?.[0] || 'any' : 'any';
  const entry = { clientId: p.client, serviceId, staffId: p.staff || null, window: windowName, from, to, added: state.today };
  const open = findSlots(state, { clientId: p.client, serviceId, staffId: p.staff, dateFrom: from, dateTo: to, window: resolveWindow(windowName), limit: 2 });
  return { ...base, kind: 'single', say: `Add ${I.client[p.client].name} to the waitlist for ${I.service[serviceId].name.toLowerCase()}${p.staff ? ` with ${I.staff[p.staff].first}` : ''}, ${describeRange(state, from, to, p.when)}?`, proposals: [{ action: { type: 'waitlist', entry }, waitlist: entry }], followUp: open.length ? `There is already a free slot: ${prettyDate(open[0].booking.date, state.today)} ${hhmm(open[0].booking.start)} with ${I.staff[open[0].booking.staffId].first}. You could book it straight away.` : null };
}

function query(state, p, base) {
  const I = idx(state);
  const date = p.when?.date || state.today;
  if (p.client && !p.staff) {
    const list = findClientBookings(state, p.client, null);
    return { ...base, kind: 'list', say: `${I.client[p.client].name}: ${list.length} upcoming`, items: list };
  }
  const list = activeBookings(state, date).filter((b) => !p.staff || b.staffId === p.staff).sort((a, b) => a.start - b.start);
  const stats = dayStats(state, date);
  const row = p.staff ? stats.rows.find((r) => r.staffId === p.staff) : null;
  const head = p.staff ? (row?.working ? `${I.staff[p.staff].first}, ${prettyDate(date, state.today).toLowerCase()}: ${list.length} clients, ${Math.round(row.utilisation * 100)}% booked` : `${I.staff[p.staff].first} isn't working ${prettyDate(date, state.today).toLowerCase()}.`) : `${prettyDate(date, state.today)}: ${list.length} appointments, ${Math.round(stats.utilisation * 100)}% of staff time booked`;
  return { ...base, kind: 'list', say: head, items: list, date };
}

// Waitlist entries that fit inside a window (a cancelled slot, or a whole day of gaps).
export function waitlistOffers(state, { date, start = 0, end = 24 * 60, staffId, excludeClient } = {}) {
  const I = idx(state);
  const offers = [];
  const taken = [];
  const entries = state.waitlist
    .filter((w) => (!w.from || w.from <= date) && (!w.to || w.to >= date))
    .sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || (a.added || '').localeCompare(b.added || ''));
  let working = state;
  for (const w of entries) {
    if (w.clientId === excludeClient || activeBookings(working, date).some((b) => b.clientId === w.clientId)) continue;
    const win = resolveWindow(w.window);
    const slots = findSlots(working, { clientId: w.clientId, serviceId: w.serviceId, staffId: w.staffId || staffId, dateFrom: date, dateTo: date, after: Math.max(start, win ? win[0] : 0), before: Math.min(end, win ? win[1] + I.service[w.serviceId].minutes : 24 * 60), limit: 1 });
    if (!slots.length) continue;
    const s = slots[0];
    offers.push({ entry: w, ...slotProposal(working, s, w.clientId), action: { type: 'create', booking: { ...s.booking, status: 'pending', source: 'waitlist' }, fromWaitlist: w.id } });
    taken.push(s.booking);
    working = { ...working, bookings: working.bookings.concat([s.booking]) };
  }
  return offers;
}

function fillGaps(state, p, base) {
  const date = p.when?.date || state.today;
  const before = dayStats(state, date);
  const offers = waitlistOffers(state, { date, staffId: p.staff || undefined });
  if (!offers.length) return { ...base, kind: 'blocked', say: `Nobody on the waitlist fits the gaps ${prettyDate(date, state.today).toLowerCase()}.`, violations: [] };
  const after = dayStats({ ...state, bookings: state.bookings.concat(offers.map((o) => o.booking)) }, date);
  return {
    ...base,
    kind: 'offers',
    say: `${offers.length} waitlist client${offers.length === 1 ? '' : 's'} fit the open time ${prettyDate(date, state.today).toLowerCase()}. Booked as pending until they reply. Utilisation ${Math.round(before.utilisation * 100)}% → ${Math.round(after.utilisation * 100)}%, +${state.catalog.studio.currency}${after.revenue - before.revenue}.`,
    proposals: offers,
    action: { type: 'plan', steps: offers.map((o) => o.action), note: `Offered ${offers.length} gaps on ${prettyDate(date, state.today)} to the waitlist` },
  };
}
