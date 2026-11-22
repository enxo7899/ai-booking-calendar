// Builds a believable, valid diary around "today" for the fictional studio.
// Every seeded booking passes the same checkBooking guardrail as live ones.

import * as catalogData from '../data/studio.js';
import { checkBooking, chooseRoom, shiftFor, idx } from './rules.js';
import { addDays, startOfWeek, mulberry32, dateRange, daysBetween, parseHHMM } from './time.js';

export function makeCatalog() {
  const { studio, services, staff, rooms, equipment, clients, usualService } = catalogData;
  // 'new' stands in for a caller who isn't on file yet, so availability questions work without a name.
  const walkIn = { id: 'new', name: 'New client', prefers: {}, channel: 'phone', virtual: true };
  return { studio, services, staff, rooms, equipment, clients: [...clients, walkIn], usualService };
}

export function seedState({ today, nowMinutes = 10 * 60, seed = 7, catalog = makeCatalog(), fill } = {}) {
  const rand = mulberry32(seed);
  const state = { catalog, today, nowMinutes, bookings: [], absences: [], waitlist: [], log: [], nextId: 1 };
  const I = idx(state);
  const from = addDays(startOfWeek(today), -7);
  const to = addDays(startOfWeek(today), 13);

  const byStaff = {};
  for (const s of catalog.staff) {
    byStaff[s.id] = catalog.clients.filter((c) => !c.virtual).filter((c) => s.skills.includes(I.service[catalog.usualService[c.id]].skill));
  }

  for (const date of dateRange(from, to)) {
    const ahead = daysBetween(today, date);
    const target = fill ?? (ahead < 0 ? 0.86 : ahead <= 2 ? 0.82 : ahead <= 6 ? 0.7 : 0.5);
    for (const s of catalog.staff) {
      const shift = shiftFor(state, s.id, date);
      if (!shift) continue;
      let t = shift.start;
      while (t < shift.end) {
        if (rand() > target) {
          t += rand() < 0.5 ? 15 : 45; // leave a gap, sometimes an awkward one
          continue;
        }
        const pool = byStaff[s.id];
        const loyal = pool.filter((c) => c.prefers.staff === s.id);
        let placed = null;
        for (let attempt = 0; attempt < 6 && !placed; attempt++) {
          const group = rand() < 0.75 && loyal.length ? loyal : pool;
          const client = group[Math.floor(rand() * group.length)];
          if (state.bookings.some((o) => o.clientId === client.id && Math.abs(daysBetween(o.date, date)) < 2)) continue;
          const usual = catalog.usualService[client.id];
          const service = I.service[s.skills.includes(I.service[usual].skill) ? usual : pickService(catalog, s, rand)];
          const b = { id: `b${state.nextId}`, clientId: client.id, serviceId: service.id, staffId: s.id, date, start: t, end: t + service.minutes, status: 'confirmed', source: rand() < 0.45 ? 'online' : rand() < 0.5 ? 'phone' : 'whatsapp' };
          b.roomId = chooseRoom(state, b);
          if (b.roomId && checkBooking(state, b, { skipTime: true }).length === 0) placed = b;
        }
        if (placed) {
          state.bookings.push(placed);
          state.nextId++;
          t = Math.ceil((placed.end + I.service[placed.serviceId].buffer) / 15) * 15;
        } else {
          t += 15;
        }
      }
    }
  }

  // A few people waiting for a slot to open.
  const wl = [
    { clientId: 'c03', serviceId: 'needling', staffId: 'arben', window: 'evening' },
    { clientId: 'c19', serviceId: 'reformer', staffId: null, window: 'evening' },
    { clientId: 'c09', serviceId: 'pelvic', staffId: 'jona', window: 'morning' },
    { clientId: 'c28', serviceId: 'followup', staffId: null, window: 'afternoon' },
    { clientId: 'c16', serviceId: 'massage', staffId: 'marco', window: 'any' },
    { clientId: 'c25', serviceId: 'followup', staffId: 'elira', window: 'morning' },
  ];
  state.waitlist = wl.map((w, i) => ({ id: `w${i + 1}`, ...w, from: today, to: addDays(today, 6), added: addDays(today, -1 - i) }));
  return state;
}

function pickService(catalog, s, rand) {
  const options = catalog.services.filter((x) => s.skills.includes(x.skill));
  return options[Math.floor(rand() * options.length)].id;
}

export function minutesNow(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

export { parseHHMM };
