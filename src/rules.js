// The guardrails. Every booking, whoever proposes it (a person dragging a block, the assistant,
// the repair planner), goes through checkBooking before it can be saved. Nothing in the UI or the
// AI layer can skip this: store.commit() refuses any booking with a violation.

import { parseHHMM, weekday, overlaps, hhmm } from './time.js';

const cache = new WeakMap();

export function idx(state) {
  let i = cache.get(state.catalog);
  if (!i) {
    const c = state.catalog;
    i = {
      service: Object.fromEntries(c.services.map((s) => [s.id, s])),
      staff: Object.fromEntries(c.staff.map((s) => [s.id, s])),
      room: Object.fromEntries(c.rooms.map((r) => [r.id, r])),
      client: Object.fromEntries(c.clients.map((x) => [x.id, x])),
      equipment: Object.fromEntries(c.equipment.map((e) => [e.id, e])),
    };
    cache.set(state.catalog, i);
  }
  return i;
}

export function shiftFor(state, staffId, date) {
  const s = idx(state).staff[staffId];
  const sh = s && s.shifts[weekday(date)];
  if (!sh) return null;
  return { start: parseHHMM(sh[0]), end: parseHHMM(sh[1]), breaks: (s.breaks || []).map((b) => ({ start: parseHHMM(b.start), end: parseHHMM(b.end) })) };
}

export function studioHours(state, date) {
  const h = state.catalog.studio.hours[weekday(date)];
  return h ? { start: parseHHMM(h[0]), end: parseHHMM(h[1]) } : null;
}

export function activeBookings(state, date) {
  return state.bookings.filter((b) => b.status !== 'cancelled' && (!date || b.date === date));
}

function bufferOf(state, b) {
  const s = idx(state).service[b.serviceId];
  return s ? s.buffer || 0 : 0;
}

// Two bookings clash on a shared resource if they overlap once each one's clean-up buffer is added.
function clashes(state, a, b) {
  return a.date === b.date && overlaps(a.start, a.end + bufferOf(state, a), b.start, b.end + bufferOf(state, b));
}

export const RULES = {
  UNKNOWN: 'Unknown client, service or staff member',
  IN_PAST: 'That time has already passed',
  TOO_SOON: 'Starts within the minimum notice period',
  CLOSED: 'The studio is closed then',
  STAFF_NOT_WORKING: 'Not on shift then',
  STAFF_ABSENT: 'Marked as absent',
  ON_BREAK: 'Overlaps a protected break',
  NOT_QUALIFIED: 'Not qualified for this service',
  BAD_DURATION: 'Length does not match the service',
  ROOM_TYPE: 'Room is not set up for this service',
  STAFF_CLASH: 'Double booking: staff member already busy',
  ROOM_CLASH: 'Room already in use (including clean-up time)',
  CLIENT_CLASH: 'Client already has an appointment then',
  EQUIPMENT_CLASH: 'Equipment already in use',
  MAX_DAILY: 'Would exceed the staff member\'s daily hands-on limit',
  NO_ROOM: 'No suitable room is free',
};

function v(code, detail) {
  return { code, message: RULES[code] + (detail ? ` (${detail})` : '') };
}

// Returns a list of violations. An empty list means the booking is safe to save.
// opts.ignore: booking ids to treat as absent (the booking being moved, or ones a plan also moves).
// opts.skipTime: skip the past/notice checks (used for evaluating historic schedules).
export function checkBooking(state, b, opts = {}) {
  const ignore = new Set(opts.ignore || []);
  if (b.id) ignore.add(b.id);
  const I = idx(state);
  const service = I.service[b.serviceId];
  const person = I.staff[b.staffId];
  if (!service || !person || !I.client[b.clientId]) return [v('UNKNOWN')];
  const out = [];

  if (!opts.skipTime) {
    if (b.date < state.today) out.push(v('IN_PAST'));
    else if (b.date === state.today && b.start < state.nowMinutes + state.catalog.studio.minLeadMinutes) {
      out.push(b.start < state.nowMinutes ? v('IN_PAST') : v('TOO_SOON', `${state.catalog.studio.minLeadMinutes} min notice`));
    }
  }

  if (b.end - b.start !== service.minutes) out.push(v('BAD_DURATION', `${service.name} is ${service.minutes} min`));

  const hours = studioHours(state, b.date);
  if (!hours || b.start < hours.start || b.end > hours.end) out.push(v('CLOSED'));

  const shift = shiftFor(state, b.staffId, b.date);
  if (!shift || b.start < shift.start || b.end > shift.end) {
    out.push(v('STAFF_NOT_WORKING', shift ? `${person.first} works ${hhmm(shift.start)}–${hhmm(shift.end)}` : `${person.first} is not in that day`));
  } else if (shift.breaks.some((br) => overlaps(b.start, b.end, br.start, br.end))) {
    out.push(v('ON_BREAK', `${person.first}'s break`));
  }

  const absent = (state.absences || []).find((a) => a.staffId === b.staffId && a.date === b.date && overlaps(b.start, b.end, a.start, a.end));
  if (absent) out.push(v('STAFF_ABSENT', absent.reason));

  if (!person.skills.includes(service.skill)) out.push(v('NOT_QUALIFIED', `${person.first} does not do ${service.name.toLowerCase()}`));

  const others = activeBookings(state, b.date).filter((o) => !ignore.has(o.id));
  const staffClash = others.find((o) => o.staffId === b.staffId && clashes(state, o, b));
  if (staffClash) out.push(v('STAFF_CLASH', `${person.first} has ${I.client[staffClash.clientId].name} at ${hhmm(staffClash.start)}`));

  const clientClash = others.find((o) => o.clientId === b.clientId && overlaps(o.start, o.end, b.start, b.end));
  if (clientClash) out.push(v('CLIENT_CLASH', `at ${hhmm(clientClash.start)}`));

  if (b.roomId) {
    const room = I.room[b.roomId];
    if (!room || !service.rooms.includes(room.type)) out.push(v('ROOM_TYPE', room ? room.name : b.roomId));
    const roomClash = others.find((o) => o.roomId === b.roomId && clashes(state, o, b));
    if (roomClash) out.push(v('ROOM_CLASH', `${room ? room.name : b.roomId} at ${hhmm(roomClash.start)}`));
  } else {
    out.push(v('NO_ROOM'));
  }

  if (service.equipment) {
    const eq = I.equipment[service.equipment];
    const inUse = others.filter((o) => I.service[o.serviceId].equipment === service.equipment && overlaps(o.start, o.end, b.start, b.end)).length;
    if (inUse >= eq.count) out.push(v('EQUIPMENT_CLASH', eq.name));
  }

  const worked = others.filter((o) => o.staffId === b.staffId).reduce((sum, o) => sum + (o.end - o.start), 0);
  if (worked + (b.end - b.start) > person.maxDailyMinutes) out.push(v('MAX_DAILY', `${Math.round(person.maxDailyMinutes / 60)} h`));

  return out;
}

// Pick a room for a booking: prefer the room the staff member is already using that day
// (fewer walks between rooms), then the first free room of a compatible type.
export function chooseRoom(state, b, opts = {}) {
  const I = idx(state);
  const service = I.service[b.serviceId];
  if (!service) return null;
  const ignore = new Set(opts.ignore || []);
  if (b.id) ignore.add(b.id);
  const others = activeBookings(state, b.date).filter((o) => !ignore.has(o.id));
  const candidates = state.catalog.rooms
    .filter((r) => service.rooms.includes(r.type))
    .map((r) => ({ r, rank: service.rooms.indexOf(r.type) * 10 - others.filter((o) => o.roomId === r.id && o.staffId === b.staffId).length }))
    .sort((x, y) => x.rank - y.rank)
    .map((x) => x.r);
  for (const r of candidates) {
    if (!others.some((o) => o.roomId === r.id && clashes(state, o, b))) return r.id;
  }
  return null;
}

// Fill in end time and room, then check. Returns { booking, violations }.
export function prepare(state, draft, opts = {}) {
  const service = idx(state).service[draft.serviceId];
  const b = { ...draft };
  if (service && b.end == null) b.end = b.start + service.minutes;
  let violations = b.roomId && !opts.reassignRoom ? checkBooking(state, b, opts) : null;
  if (!violations || violations.some((x) => x.code === 'ROOM_CLASH' || x.code === 'ROOM_TYPE')) {
    const room = chooseRoom(state, b, opts);
    if (room || !b.roomId) b.roomId = room;
    violations = checkBooking(state, b, opts);
  }
  return { booking: b, violations };
}
