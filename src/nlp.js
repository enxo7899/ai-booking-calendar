// Turns a receptionist's sentence into a structured intent.
//
// This is the offline stand-in for the LLM step: it returns exactly the JSON shape that
// llm/claude-intent.js asks Claude for (see src/intent-schema.js), so the rest of the system
// can't tell which one produced it. Either way the intent is only a proposal: slots are found
// and checked by code, and nothing is saved until a person presses Confirm.

import { idx, activeBookings } from './rules.js';
import { addDays, weekday, DAY_NAMES, MONTHS, startOfWeek, toDate, fromDate } from './time.js';

export function norm(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\b(what|who|she|he|it|there|when|where|that)'s\b/g, '$1 is')
    .replace(/\bcan'?t\b/g, 'cannot')
    .replace(/\bwon'?t\b/g, 'will not')
    .replace(/(\w)n't\b/g, '$1 not')
    .replace(/\b(half|quarter) past (\w+)/g, (m, q, h) => `${NUM[h] ?? h}:${q === 'half' ? '30' : '15'}`)
    .replace(/\bquarter to (\w+)/g, (m, h) => `${(NUM[h] ?? Number(h)) - 1}:45`)
    .replace(/(\w)'s\b/g, '$1')
    .replace(/[“”"]/g, '')
    .replace(/[^a-z0-9:'\/\-\s.,?!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1, couple: 2 };
const DAY_ALIASES = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
  // Albanian and Italian, for receptionists who switch language mid-sentence
  'e hene': 1, 'e marte': 2, 'e merkure': 3, 'e enjte': 4, 'e premte': 5, 'e shtune': 6,
  henen: 1, marten: 2, merkuren: 3, enjten: 4, premten: 5, shtunen: 6,
  lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6,
};
const DAY_RE = Object.keys(DAY_ALIASES).sort((a, b) => b.length - a.length).join('|');
const MONTH_RE = MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|');

const INTENTS = [
  ['fill_gaps', /\b(fill (in )?(the )?gaps|tidy (up )?(the )?(day|diary|schedule)|optimi[sz]e|compact|use the waitlist|offer (the )?gaps?)\b/],
  ['staff_off', /\b(called in sick|calls? in sick|is (off )?sick|off sick|(is|are) ill|unwell|not feeling well|feeling ill|is off|off (today|tomorrow|on)|day off|not coming in|cannot come in|(will not|not) be in|is out|be out|out (this|today|tomorrow|on)|on holiday|on leave|annual leave|is away|absent|(has|have) (a|an) (\w+ )?(emergency|funeral|training|appointment)|has training|(has|needs) to leave|leaving early|leaving at|left early|go(ing)? home|i semure|semur|malat[oa])\b/],
  ['waitlist', /\b(wait ?list|waiting list|if (anything|something|a slot|a space) (opens|comes up|frees)|let (him|her|them|me) know if)\b/],
  ['cancel', /\b(cancel|cancell|call off|can'?t make|cannot make|will not make|not make it|not coming|no longer (needs|coming)|drop (her|his|their)|anullo|annulla)\w*/],
  ['move', /\b(move|moved|reschedule|rebook|push|shift|bring (\w+ )?forward|postpone|change (her|his|their|the) (time|appointment|slot|booking)|later|earlier|spost\w*|zhvendos\w*)\b/],
  ['query', /\b(what (does|do|has)|what is on|what is (\w+ )?(day|diary|schedule)|who('?s| is)? (in|working|on|free)|show me|how (busy|full)|schedule for|diary for|list)\b/],
  ['find', /\b(when (can|could|is|does)|earliest|free (slot|time|space)s?|(any|a|free|open)( \w+){0,3} (slots?|space|gaps?|availability|openings?|free time)|availability|available|options|find (a |me )?(slot|time|space|gap))\b/],
  ['book', /\b(book|booking|schedule|put (him|her|them|\w+) (in|down)|add (him|her|them|\w+)|fit (him|her|them|\w+) in|make (an|a) appointment|reserve|appointment for|session for|needs? (a|an|another)|wants? (a|an|another)|would like (a|an)|rezervo|prenota)\b/],
];

export function parseCommand(text, state) {
  const I = idx(state);
  const t = norm(text);
  const trace = [];
  const out = { intent: null, client: null, clientCandidates: [], staff: null, service: null, when: null, target: null, absence: null, delta: null, confidence: 0, missing: [], trace, text };

  for (const [name, re] of INTENTS) {
    const m = t.match(re);
    if (m) {
      out.intent = name;
      trace.push({ kind: 'intent', value: name, match: m[0] });
      break;
    }
  }

  // Staff: full name, first name or "with anyone".
  for (const s of state.catalog.staff) {
    const re = new RegExp(`\\b(${norm(s.name)}|${norm(s.first)})\\b`);
    const m = t.match(re);
    if (m) {
      out.staff = s.id;
      trace.push({ kind: 'staff', value: s.id, match: m[0] });
      break;
    }
  }
  if (/\b(anyone|anybody|whoever|any therapist|any physio|doesn'?t matter who)\b/.test(t)) {
    out.staff = null;
    out.anyStaff = true;
  }

  // Service: longest alias wins ("sports massage" over "massage").
  const aliases = state.catalog.services.flatMap((s) => [norm(s.name), ...s.aliases.map(norm)].map((a) => ({ a, id: s.id }))).sort((x, y) => y.a.length - x.a.length);
  for (const { a, id } of aliases) {
    const m = t.match(new RegExp(`\\b${a.replace(/[-\s]+/g, '[-\\s]?')}\\b`));
    if (m) {
      out.service = id;
      trace.push({ kind: 'service', value: id, match: m[0] });
      break;
    }
  }

  // Client: full name, then unique first name or surname. Ambiguity is reported, never guessed.
  const staffWords = new Set(state.catalog.staff.flatMap((s) => norm(s.name).split(' ')));
  const full = state.catalog.clients.filter((c) => !c.virtual).filter((c) => new RegExp(`\\b${norm(c.name)}\\b`).test(t));
  if (full.length) {
    out.client = full[0].id;
    trace.push({ kind: 'client', value: full[0].id, match: norm(full[0].name) });
  } else {
    const byFirst = state.catalog.clients.filter((c) => !c.virtual).filter((c) => {
      const [first, ...rest] = norm(c.name).split(' ');
      const last = rest.join(' ');
      if (new RegExp(`\\b${first}\\b`).test(t) && !staffWords.has(first)) return true;
      if (last && !staffWords.has(last) && new RegExp(`\\b(mr|mrs|ms|miss|signora|signor|zonja|zoti)?\\s?${last}\\b`).test(t)) return true;
      return false;
    });
    if (byFirst.length === 1) {
      out.client = byFirst[0].id;
      trace.push({ kind: 'client', value: byFirst[0].id, match: norm(byFirst[0].name).split(' ')[0] });
    } else if (byFirst.length > 1) {
      out.clientCandidates = byFirst.map((c) => c.id);
      trace.push({ kind: 'client', value: 'ambiguous', match: byFirst.map((c) => c.name).join(' / ') });
    }
  }

  // Time expressions. For moves, the part after "to" is where it goes.
  const split = splitMove(t, out.intent);
  out.when = parseWhen(split.source, state);
  if (split.target != null) out.target = parseWhen(split.target, state);
  out.delta = parseDelta(t);
  if (out.intent === 'move' && !out.target && out.delta == null && out.when && (out.when.date || out.when.time != null)) {
    // "move Ana to Friday" with no "from" part: what we parsed is the destination.
    out.target = out.when;
    out.when = null;
  }

  if (!out.intent) {
    if (out.client && (out.when?.date || out.when?.time != null)) out.intent = 'book';
    else if (out.staff && !out.client && out.when?.date) out.intent = 'query';
    else if (out.client || out.clientCandidates.length) out.intent = 'book';
    if (out.intent) trace.push({ kind: 'intent', value: out.intent, match: '(inferred)' });
  }
  if (out.intent === 'move' && out.delta == null && !out.target && /\b(later|earlier)\b/.test(t)) out.delta = /later/.test(t) ? 60 : -60;

  if (out.intent === 'staff_off') {
    const w = out.when || {};
    const reason = /sick|ill|unwell|semur|malat/.test(t) ? 'Off sick' : /holiday|leave/.test(t) ? 'Holiday' : /emergency|funeral/.test(t) ? 'Emergency' : /training/.test(t) ? 'Training' : 'Unavailable';
    let start = 0;
    let end = 24 * 60;
    if (w.window) [start, end] = w.window;
    if (w.after != null) start = w.after;
    if (w.before != null) end = w.before;
    if (/leaving early|left early|leave early|leave at|leaving at|to leave|go(ing)? home/.test(t) && w.time != null) start = w.time;
    else if (w.time != null && /\b(from|after|at)\b/.test(t)) start = w.time;
    out.absence = { staffId: out.staff, date: w.date || state.today, start, end, reason };
  }

  // Booking ids the sentence refers to (for move / cancel).
  if ((out.intent === 'move' || out.intent === 'cancel') && out.client) {
    out.bookingCandidates = findClientBookings(state, out.client, out.when).map((b) => b.id);
  }

  out.missing = missingFor(out, state);
  out.confidence = confidence(out);
  return out;
}

function splitMove(t, intent) {
  if (intent !== 'move') return { source: t, target: null };
  const m = t.match(/^(.*?)\b(to|till|until|for|into|over to|onto|instead to)\b(?!\s+(an|a|the)?\s*(hour|minute|min))(.*)$/);
  if (!m) return { source: t, target: null };
  // "to" inside "next to", "move ana to" etc.: only split when the right side contains a time or day.
  const right = m[5];
  if (!hasTimeWords(right)) return { source: t, target: null };
  return { source: m[1], target: right };
}

function hasTimeWords(s) {
  return new RegExp(`\\b(${DAY_RE}|today|tomorrow|tonight|morning|afternoon|evening|noon|midday|lunch|next|this|weekend|week|\\d{1,2}(:\\d{2})?\\s?(am|pm)?|${MONTH_RE}|sot|neser|oggi|domani)\\b`).test(s);
}

export function parseDelta(t) {
  const m = t.match(/\b(back|later|forward|earlier|by)\b.*?\b(an?|one|two|three|half an?|\d+(\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/) || t.match(/\b(an?|one|two|three|half an?|\d+)\s*(hours?|hrs?|minutes?|mins?)\s+(later|earlier|back|forward)\b/);
  if (!m) return null;
  let qty;
  let unit;
  let dir;
  if (m[4] !== undefined && /back|later|forward|earlier|by/.test(m[1])) {
    qty = m[2];
    unit = m[4];
    dir = /forward|earlier/.test(m[1]) || /earlier|forward/.test(t) ? -1 : 1;
  } else {
    qty = m[1];
    unit = m[2];
    dir = /earlier|forward/.test(m[3]) ? -1 : 1;
  }
  let n = /^half/.test(qty) ? 0.5 : NUM[qty] ?? Number(qty);
  const minutes = /^h/.test(unit) ? n * 60 : n;
  return dir * Math.round(minutes);
}

// Returns { date, dateTo, time, window, after, before, label[] }.
export function parseWhen(t, state) {
  const today = state.today;
  const r = { date: null, dateTo: null, time: null, window: null, after: null, before: null, labels: [] };
  let m;

  if ((m = t.match(/\b(day after tomorrow|pasneser|dopodomani)\b/))) { r.date = addDays(today, 2); r.labels.push(m[0]); }
  else if ((m = t.match(/\b(tomorrow|tmrw|tmr|neser|domani)\b/))) { r.date = addDays(today, 1); r.labels.push(m[0]); }
  else if ((m = t.match(/\b(today|tonight|this (morning|afternoon|evening)|sot|oggi|stasera)\b/))) { r.date = today; r.labels.push(m[0]); }
  else if ((m = t.match(/\bin (a|one|two|three|\d+) (days?|weeks?)\b/))) {
    const n = NUM[m[1]] ?? Number(m[1]);
    r.date = addDays(today, /week/.test(m[2]) ? 7 * n : n);
    if (/week/.test(m[2])) { r.date = startOfWeek(r.date); r.dateTo = addDays(r.date, 5); }
    r.labels.push(m[0]);
  } else if ((m = t.match(new RegExp(`\\b(next|this|coming|on|e)?\\s*(${DAY_RE})\\b(\\s+(next week|after next))?`)))) {
    const wd = DAY_ALIASES[m[2]];
    let diff = (wd - weekday(today) + 7) % 7;
    if (diff === 0 && m[1] !== 'this') diff = 7;
    // "next Tuesday" and "Tuesday next week" both mean the Tuesday of next week (Monday-based).
    if (m[1] === 'next' || m[4] === 'next week') diff = daysToNextMonday(today) + ((wd + 6) % 7);
    if (m[4] === 'after next') diff = daysToNextMonday(today) + 7 + ((wd + 6) % 7);
    r.date = addDays(today, diff);
    r.labels.push(m[0].trim());
  } else if ((m = t.match(new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?\\s+(of\\s+)?(${MONTH_RE})\\b`))) || (m = t.match(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(st|nd|rd|th)?\\b`)))) {
    const day = Number(/\d/.test(m[1]) ? m[1] : m[2]);
    const monthName = /\d/.test(m[1]) ? m[4] : m[1];
    const month = MONTHS.findIndex((x) => x.startsWith(monthName.slice(0, 3)));
    r.date = nextDate(today, month, day);
    r.labels.push(m[0]);
  } else if ((m = t.match(/\b(\d{1,2})[\/.](\d{1,2})\b/)) && !/\d:\d/.test(m[0])) {
    r.date = nextDate(today, Number(m[2]) - 1, Number(m[1]));
    r.labels.push(m[0]);
  } else if ((m = t.match(/\bthe (\d{1,2})(st|nd|rd|th)\b/))) {
    const d = toDate(today);
    let candidate = fromDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Number(m[1]))));
    if (candidate < today) candidate = fromDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, Number(m[1]))));
    r.date = candidate;
    r.labels.push(m[0]);
  } else if ((m = t.match(/\b(this week|later this week|rest of the week|sometime this week|kete jave|questa settimana)\b/))) {
    r.date = today;
    r.dateTo = addDays(startOfWeek(today), 5);
    r.labels.push(m[0]);
  } else if ((m = t.match(/\b(next week|javen tjeter|settimana prossima)\b/))) {
    r.date = addDays(today, daysToNextMonday(today));
    r.dateTo = addDays(r.date, 5);
    r.labels.push(m[0]);
  } else if ((m = t.match(/\b(this weekend|weekend|saturday morning)\b/))) {
    r.date = addDays(today, (6 - weekday(today) + 7) % 7);
    r.labels.push(m[0]);
  }

  // Parts of the day.
  if ((m = t.match(/\b(first thing|early morning)\b/))) { r.window = [7 * 60 + 30, 9 * 60 + 30]; r.labels.push(m[0]); }
  else if ((m = t.match(/\b(morning|mengjes|mattina|am slot)\b/))) { r.window = [7 * 60 + 30, 12 * 60]; r.labels.push(m[0]); }
  else if ((m = t.match(/\b(lunchtime|lunch time|over lunch|around lunch|midday)\b/))) { r.window = [11 * 60 + 30, 14 * 60]; r.labels.push(m[0]); }
  else if ((m = t.match(/\b(afternoon|pasdite|pomeriggio)\b/))) { r.window = [12 * 60, 17 * 60]; r.labels.push(m[0]); }
  else if ((m = t.match(/\b(evening|tonight|after work|end of the day|end of day|late|darke|sera|stasera)\b/))) { r.window = [17 * 60, 20 * 60]; r.labels.push(m[0]); }

  // after / before
  const clock = '(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm)?|noon|midday';
  if ((m = t.match(new RegExp(`\\b(after|from|not before|no earlier than|pas oreve|dopo le)\\s+(${clock})\\b`)))) {
    r.after = toMinutes(m[2], m[3], m[4], m[5]);
    r.labels.push(m[0]);
  }
  if ((m = t.match(new RegExp(`\\b(before|by|until|till|no later than|finish by|para oreve|prima delle)\\s+(${clock})\\b`)))) {
    const v = toMinutes(m[2], m[3], m[4], m[5]);
    if (v != null) { r.before = v; r.labels.push(m[0]); }
  }
  // An exact time: "at 3", "3pm", "15:30", "noon".
  const exact = t.match(new RegExp(`\\b(at|@|ne|alle|around|about)\\s+(${clock})\\b`)) || t.match(/\b(\d{1,2}):(\d{2})\s?(am|pm)?\b/) || t.match(/\b(\d{1,2})\s?(am|pm)\b/) || t.match(/\b(noon|midday)\b/);
  if (exact && !(r.after != null && t.indexOf(exact[0]) >= 0 && new RegExp(`(after|from|before|by|until|till)\\s+${escape(exact[0])}`).test(t))) {
    let v = null;
    if (exact[2] !== undefined && /^(at|@|ne|alle|around|about)$/.test(exact[1])) v = toMinutes(exact[2], exact[3], exact[4], exact[5]);
    else if (/^\d/.test(exact[1]) && exact[2] && /^\d{2}$/.test(exact[2])) v = toMinutes(exact[0], exact[1], exact[2], exact[3]);
    else if (/^\d/.test(exact[1])) v = toMinutes(exact[0], exact[1], undefined, exact[2]);
    else v = 12 * 60;
    if (v != null && (r.after == null || v !== r.after) && (r.before == null || v !== r.before)) {
      r.time = v;
      r.labels.push(exact[0]);
    }
  }
  return r;
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Clock words to minutes. Bare 1–7 mean afternoon (a studio open 08–20 doesn't see 3am clients).
function toMinutes(whole, h, mm, ampm) {
  if (/noon|midday/.test(whole)) return 12 * 60;
  let hour = Number(h);
  if (Number.isNaN(hour) || hour > 23) return null;
  const min = mm ? Number(mm) : 0;
  if (ampm === 'pm' && hour < 12) hour += 12;
  else if (ampm === 'am' && hour === 12) hour = 0;
  else if (!ampm && hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + min;
}

function daysToNextMonday(today) {
  const wd = weekday(today);
  return wd === 0 ? 1 : 8 - wd;
}

function nextDate(today, month, day) {
  const y = Number(today.slice(0, 4));
  let d = fromDate(new Date(Date.UTC(y, month, day)));
  if (d < today) d = fromDate(new Date(Date.UTC(y + 1, month, day)));
  return d;
}

export function findClientBookings(state, clientId, when) {
  let list = activeBookings(state).filter((b) => b.clientId === clientId && b.date >= state.today && !(b.date === state.today && b.end <= state.nowMinutes));
  if (when?.date) list = list.filter((b) => (when.dateTo ? b.date >= when.date && b.date <= when.dateTo : b.date === when.date));
  if (when?.time != null) list = list.filter((b) => b.start === when.time || Math.abs(b.start - when.time) <= 30);
  if (when?.window) list = list.filter((b) => b.start >= when.window[0] && b.start < when.window[1]);
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

function missingFor(o) {
  const miss = [];
  if (!o.intent) miss.push('intent');
  if (['book', 'move', 'cancel', 'waitlist'].includes(o.intent) && !o.client) miss.push(o.clientCandidates.length ? 'which_client' : 'client');
  if (o.intent === 'staff_off' && !o.absence?.staffId) miss.push('staff');
  if ((o.intent === 'move' || o.intent === 'cancel') && o.client && !(o.bookingCandidates || []).length) miss.push('booking');
  return miss;
}

function confidence(o) {
  if (!o.intent) return 0.1;
  let c = 0.55;
  if (o.trace.some((x) => x.kind === 'intent' && x.match !== '(inferred)')) c += 0.2;
  if (o.client || o.staff) c += 0.1;
  if (o.when && (o.when.date || o.when.time != null || o.when.window)) c += 0.1;
  if (o.missing.length) c -= 0.25;
  return Math.max(0.05, Math.min(0.98, Math.round(c * 100) / 100));
}

// Plain JSON view of an intent: the same shape the LLM adapter must return.
export function toIntentJSON(p) {
  return {
    intent: p.intent,
    client_id: p.client,
    client_candidates: p.clientCandidates.length ? p.clientCandidates : undefined,
    staff_id: p.staff,
    service_id: p.service,
    when: p.when ? compactWhen(p.when) : undefined,
    target: p.target ? compactWhen(p.target) : undefined,
    shift_minutes: p.delta ?? undefined,
    absence: p.absence || undefined,
    missing: p.missing.length ? p.missing : undefined,
    confidence: p.confidence,
  };
}

function compactWhen(w) {
  const o = {};
  if (w.date) o.date = w.date;
  if (w.dateTo) o.date_to = w.dateTo;
  if (w.time != null) o.time = `${String(Math.floor(w.time / 60)).padStart(2, '0')}:${String(w.time % 60).padStart(2, '0')}`;
  if (w.window) o.window = w.window.map((x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`);
  if (w.after != null) o.after = `${String(Math.floor(w.after / 60)).padStart(2, '0')}:${String(w.after % 60).padStart(2, '0')}`;
  if (w.before != null) o.before = `${String(Math.floor(w.before / 60)).padStart(2, '0')}:${String(w.before % 60).padStart(2, '0')}`;
  return Object.keys(o).length ? o : undefined;
}

export { DAY_NAMES };
