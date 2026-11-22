// The contract between "understanding the sentence" and "doing something safe with it".
// Both the offline parser (src/nlp.js) and the Claude adapter (llm/claude-intent.js) produce this
// shape. Everything after it (slot search, guardrails, confirmation) is ordinary code.

const hhmm = { type: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$' };
const when = {
  type: 'object',
  additionalProperties: false,
  properties: {
    date: { type: 'string', description: 'YYYY-MM-DD in studio local time' },
    date_to: { type: 'string', description: 'End of a date range, YYYY-MM-DD' },
    time: hhmm,
    window: { type: 'array', items: hhmm, description: '[start, end] part of the day' },
    after: hhmm,
    before: hhmm,
  },
};

export const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'confidence'],
  properties: {
    intent: { type: ['string', 'null'], enum: ['book', 'find', 'move', 'cancel', 'staff_off', 'waitlist', 'query', 'fill_gaps', null] },
    client_id: { type: ['string', 'null'], description: 'Exact client id from the list, or null' },
    client_candidates: { type: 'array', items: { type: 'string' }, description: 'When a name matches several clients, all of their ids' },
    staff_id: { type: ['string', 'null'] },
    service_id: { type: ['string', 'null'] },
    when,
    target: { ...when, description: 'For move: where the appointment should go' },
    shift_minutes: { type: 'integer', description: 'For "push back an hour" style moves: +60' },
    absence: {
      type: 'object',
      additionalProperties: false,
      properties: { staffId: { type: 'string' }, date: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, reason: { type: 'string' } },
    },
    missing: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
};

const INTENTS = new Set(['book', 'find', 'move', 'cancel', 'staff_off', 'waitlist', 'query', 'fill_gaps', null]);

// Never trust model output blindly: unknown ids are dropped, so the code downstream asks
// a question instead of acting on an invented client or therapist.
export function sanitizeIntent(raw, catalog) {
  const ids = (list) => new Set(list.map((x) => x.id));
  const clients = ids(catalog.clients);
  const staff = ids(catalog.staff);
  const services = ids(catalog.services);
  const out = { ...raw };
  if (!INTENTS.has(out.intent)) out.intent = null;
  if (out.client_id && !clients.has(out.client_id)) out.client_id = null;
  if (out.staff_id && !staff.has(out.staff_id)) out.staff_id = null;
  if (out.service_id && !services.has(out.service_id)) out.service_id = null;
  if (out.client_candidates) out.client_candidates = out.client_candidates.filter((c) => clients.has(c));
  if (out.absence && !staff.has(out.absence.staffId)) delete out.absence;
  return out;
}
