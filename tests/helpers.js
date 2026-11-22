import { seedState } from '../src/seed.js';

// A fixed Tuesday morning so every test sees the same diary.
export const TODAY = '2026-11-24';
export function fresh(opts = {}) {
  return seedState({ today: TODAY, nowMinutes: 9 * 60 + 40, ...opts });
}

// An empty diary on the same catalogue, for rule tests that need full control.
export function empty() {
  const s = fresh();
  return { ...s, bookings: [], waitlist: [], absences: [] };
}
