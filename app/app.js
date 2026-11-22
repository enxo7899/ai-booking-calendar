// Orari demo UI. All scheduling logic lives in ../src and is shared with the tests;
// this file only draws the diary and passes actions to the store.

import { seedState, minutesNow } from '../src/seed.js';
import { createHistory } from '../src/store.js';
import { idx, prepare, shiftFor, studioHours, activeBookings } from '../src/rules.js';
import { dayStats } from '../src/slots.js';
import { respond, EXAMPLES, waitlistOffers } from '../src/assistant.js';
import { addDays, startOfWeek, localToday, hhmm, parseHHMM, prettyDate, fmt12, weekday, toDate, MONTHS, DAY_SHORT, DAY_NAMES, daysBetween } from '../src/time.js';

const params = new URLSearchParams(location.search);
const TODAY = params.get('today') || localToday();
const NOW = params.get('now') ? parseHHMM(params.get('now')) : minutesNow();
const history = createHistory(seedState({ today: TODAY, nowMinutes: NOW }));
const S = () => history.state;
const I = () => idx(S());

const ui = {
  date: firstOpenDay(TODAY),
  view: params.get('view') || 'day',
  hidden: new Set(),
  thread: [],
  outbox: [],
  tab: 'assistant',
  flash: new Set(),
  mobile: 'board',
};
if (params.get('date')) ui.date = params.get('date');

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PX = 64 / 60; // pixels per minute (matches --hour)
const COLORS = { fit: '#1f5c4a', time: '#5d8c6f', soon: '#9fb8a4', tidy: '#b4532a', load: '#d2b48c' };

function firstOpenDay(d) {
  for (let i = 0; i < 7; i++) {
    const x = addDays(d, i);
    const hours = studioHours(S(), x);
    if (hours && (i > 0 || NOW < hours.end - 60)) return x;
  }
  return d;
}

function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c) => Math.round(c * a + 255 * (1 - a));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function dayWord(date) {
  const diff = daysBetween(TODAY, date);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff > 1 && diff < 7) return `on ${DAY_NAMES[weekday(date)].replace(/^./, (c) => c.toUpperCase())}`;
  return `on ${prettyDate(date)}`;
}

/* ---------- Header ---------- */

function renderHeader() {
  const d = toDate(ui.date);
  let label;
  if (ui.view === 'week') {
    const ws = startOfWeek(ui.date);
    const we = addDays(ws, 5);
    label = `${prettyDate(ws)} – ${prettyDate(we)} <span>${toDate(ws).getUTCFullYear()}</span>`;
  } else if (ui.view === 'agenda') {
    label = `Next 7 days <span>from ${prettyDate(ui.date)}</span>`;
  } else {
    const rel = prettyDate(ui.date, TODAY);
    label = `${DAY_NAMES[d.getUTCDay()].replace(/^./, (c) => c.toUpperCase())} ${d.getUTCDate()} ${cap(MONTHS[d.getUTCMonth()])}${['Today', 'Tomorrow', 'Yesterday'].includes(rel) ? ` <span>· ${rel}</span>` : ''}`;
  }
  $('#dateLabel').innerHTML = label;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === ui.view));
  $('#undoBtn').disabled = !history.canUndo;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Rail ---------- */

function renderRail() {
  const st = S();
  const stats = dayStats(st, ui.date);
  const m = toDate(ui.date);
  const first = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const gridStart = startOfWeek(first);
  let cal = `<div class="mini-head"><span>${cap(MONTHS[m.getUTCMonth()])} ${m.getUTCFullYear()}</span><span><button data-month="-1" aria-label="Previous month">‹</button><button data-month="1" aria-label="Next month">›</button></span></div><table class="mini"><tr>${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<th>${x}</th>`).join('')}</tr>`;
  for (let w = 0; w < 6; w++) {
    cal += '<tr>';
    for (let i = 0; i < 7; i++) {
      const d = addDays(gridStart, w * 7 + i);
      const cls = [d === TODAY ? 'today' : '', d === ui.date ? 'sel' : '', toDate(d).getUTCMonth() !== m.getUTCMonth() ? 'out' : '', !studioHours(st, d) ? 'closed' : ''].join(' ');
      cal += `<td><button class="${cls}" data-date="${d}">${toDate(d).getUTCDate()}</button></td>`;
    }
    cal += '</tr>';
  }
  cal += '</table>';

  const staffRows = st.catalog.staff.map((s) => {
    const r = stats.rows.find((x) => x.staffId === s.id);
    const pct = r.working ? `${Math.round(r.utilisation * 100)}%` : 'off';
    return `<div class="staff-row ${ui.hidden.has(s.id) ? 'off' : ''}" data-toggle-staff="${s.id}" title="Show or hide ${esc(s.first)}"><i class="dot" style="background:${s.color}"></i><div>${esc(s.name)}<small>${esc(s.role)}</small></div><span class="pct">${pct}</span></div>`;
  }).join('');

  const wl = st.waitlist.length
    ? st.waitlist.map((w) => `<div class="wl">${esc(I().client[w.clientId].name)}${w.priority ? '<span class="prio">priority</span>' : ''}<small>${esc(I().service[w.serviceId].short)}${w.staffId ? ` with ${esc(I().staff[w.staffId].first)}` : ''} · ${esc(w.window === 'any' ? 'any time' : w.window)}</small></div>`).join('')
    : '<div class="muted-empty">Nobody waiting.</div>';

  $('#rail').innerHTML = `
    ${cal}
    <h3>${esc(prettyDate(ui.date, TODAY))} at a glance</h3>
    <div class="stat-line"><span>Appointments</span><b>${stats.count}</b></div>
    <div class="stat-line"><span>Staff time booked</span><b>${Math.round(stats.utilisation * 100)}%</b></div>
    <div class="bar" style="margin:2px 0 4px"><i style="width:${Math.round(stats.utilisation * 100)}%"></i></div>
    <div class="stat-line" title="Free gaps shorter than 30 minutes: too short to sell"><span>Unsellable gaps</span><b>${stats.dead} min</b></div>
    <div class="stat-line"><span>Booked revenue</span><b>${st.catalog.studio.currency}${stats.revenue}</b></div>
    <h3>Team</h3>
    ${staffRows}
    <h3>Waitlist · ${st.waitlist.length}</h3>
    ${wl}
  `;
}

/* ---------- Board: day view ---------- */

function dayBounds(dates) {
  let start = 24 * 60;
  let end = 0;
  for (const d of dates) {
    const h = studioHours(S(), d);
    if (h) { start = Math.min(start, h.start); end = Math.max(end, h.end); }
    for (const s of S().catalog.staff) {
      const sh = shiftFor(S(), s.id, d);
      if (sh) { start = Math.min(start, sh.start); end = Math.max(end, sh.end); }
    }
  }
  if (start >= end) return { start: 8 * 60, end: 20 * 60 };
  return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
}

function bookingBlock(b, top, opts = {}) {
  const i = I();
  const s = i.staff[b.staffId];
  const svc = i.service[b.serviceId];
  const h = (b.end - b.start) * PX - 2;
  const past = b.date < TODAY || (b.date === TODAY && b.end <= NOW);
  const cls = ['bk', past ? 'past' : '', b.status === 'pending' ? 'pending' : '', ui.flash.has(b.id) ? 'flash' : '', opts.leaving ? 'leaving' : ''].join(' ');
  const tag = b.status === 'pending' ? `<span class="tag">${b.source === 'waitlist' ? 'offered' : 'moved'}</span>` : '';
  const style = `top:${top}px;height:${h}px;--c:${s.color};--tint:${tint(s.color, 0.12)};--edge:${tint(s.color, 0.35)};${opts.lane ? `left:calc(${opts.lane.left}% + 2px);right:auto;width:calc(${opts.lane.width}% - 4px);` : ''}`;
  const compact = h < 40;
  const body = compact
    ? `<b>${tag}${esc(i.client[b.clientId].name)}</b>`
    : `<b>${tag}${esc(i.client[b.clientId].name)}</b><div class="meta">${esc(opts.week ? `${s.first} · ${svc.short}` : `${svc.short} · ${i.room[b.roomId]?.name || ''}`)}</div>${h > 58 ? `<div class="t">${hhmm(b.start)}–${hhmm(b.end)}</div>` : ''}`;
  return `<div class="${cls}" style="${style}" data-booking="${b.id}" ${past ? 'data-past="1"' : ''} title="${esc(`${i.client[b.clientId].name} · ${svc.name} · ${hhmm(b.start)}–${hhmm(b.end)}`)}">${body}</div>`;
}

// Proposals that haven't been confirmed yet are drawn on the calendar as dashed outlines,
// so a person sees exactly what will change before pressing anything.
function pendingPreview() {
  const item = [...ui.thread].reverse().find((x) => x.role === 'assistant' || x.role === 'note');
  if (!item || item.done != null) return { ghosts: [], leaving: new Set() };
  const ghosts = [];
  const leaving = new Set();
  const r = item.res;
  if (r?.kind === 'plan') {
    for (const row of r.plan.rows) {
      leaving.add(row.orig.id);
      if (row.next) ghosts.push({ b: row.next, label: I().client[row.orig.clientId].name, sub: 'proposed' });
      if (row.ripple) { leaving.add(row.ripple.orig.id); ghosts.push({ b: row.ripple.next, label: I().client[row.ripple.orig.clientId].name, sub: 'asked to shift' }); }
    }
  } else if (item.offers || r?.kind === 'offers') {
    for (const o of item.offers || r.proposals) ghosts.push({ b: o.booking, label: I().client[o.entry.clientId].name, sub: 'waitlist offer' });
  } else if (r?.proposals?.length && (r.kind === 'slots' || r.kind === 'blocked' || r.kind === 'single')) {
    r.proposals.forEach((p, k) => {
      if (!p.booking || p.action.type === 'cancel') return;
      if (p.action.type === 'move') leaving.add(p.action.id);
      ghosts.push({ b: p.booking, label: r.proposals.length > 1 ? `Option ${k + 1}` : 'Proposed', sub: p.score != null ? `${p.score}/100` : '' });
    });
    if (r.kind === 'single' && r.proposals[0].action.type === 'cancel') leaving.add(r.proposals[0].action.id);
  }
  return { ghosts, leaving };
}

function renderDay() {
  const st = S();
  const date = ui.date;
  const hours = studioHours(st, date);
  if (!hours) {
    return `<div class="closed-note"><b>Closed ${esc(prettyDate(date, TODAY).toLowerCase())}</b>The studio is closed on ${esc(DAY_NAMES[weekday(date)])}s. <button class="link" data-goto-open>Go to the next open day</button></div>`;
  }
  const staff = st.catalog.staff.filter((s) => !ui.hidden.has(s.id));
  const { start, end } = dayBounds([date]);
  const height = (end - start) * PX;
  const stats = dayStats(st, date);
  const preview = pendingPreview();
  const cols = `56px repeat(${staff.length}, minmax(148px, 1fr))`;

  let head = `<div class="grid-head" style="grid-template-columns:${cols}"><div></div>`;
  for (const s of staff) {
    const sh = shiftFor(st, s.id, date);
    const r = stats.rows.find((x) => x.staffId === s.id);
    head += `<div class="col-head ${sh ? '' : 'closed'}"><b><i style="background:${s.color}"></i>${esc(s.first)}</b><small>${sh ? `${hhmm(sh.start)}–${hhmm(sh.end)} · ${Math.round(r.utilisation * 100)}%` : 'Not in today'}</small>${sh ? `<div class="bar"><i style="width:${Math.round(r.utilisation * 100)}%;background:${s.color}"></i></div>` : ''}</div>`;
  }
  head += '</div>';

  let gutter = `<div class="gutter" style="height:${height}px">`;
  for (let t = start + 60; t < end; t += 60) gutter += `<span style="top:${(t - start) * PX}px">${hhmm(t)}</span>`;
  gutter += '</div>';

  let body = '';
  for (const s of staff) {
    const sh = shiftFor(st, s.id, date);
    let col = `<div class="col" data-col="${s.id}" style="height:${height}px">`;
    for (let t = start; t < end; t += 60) col += `<div class="hourline" style="top:${(t - start) * PX}px"></div><div class="halfline" style="top:${(t + 30 - start) * PX}px"></div>`;
    if (!sh) {
      col += `<div class="offshift" style="top:0;height:${height}px"></div>`;
    } else {
      if (sh.start > start) col += `<div class="offshift" style="top:0;height:${(sh.start - start) * PX}px"></div>`;
      if (sh.end < end) col += `<div class="offshift" style="top:${(sh.end - start) * PX}px;height:${(end - sh.end) * PX}px"></div>`;
      col += `<div class="cell-hit" data-hit="${s.id}" style="top:${(sh.start - start) * PX}px;height:${(sh.end - sh.start) * PX}px"></div>`;
      for (const br of sh.breaks) col += `<div class="breakblock" style="top:${(br.start - start) * PX}px;height:${(br.end - br.start) * PX}px">break</div>`;
    }
    for (const a of st.absences.filter((x) => x.staffId === s.id && x.date === date)) {
      const a0 = Math.max(a.start, sh ? sh.start : start);
      const a1 = Math.min(a.end, sh ? sh.end : end);
      if (a1 > a0) col += `<div class="absence" style="top:${(a0 - start) * PX}px;height:${(a1 - a0) * PX}px"><span>${esc(a.reason)}</span></div>`;
    }
    for (const b of activeBookings(st, date).filter((x) => x.staffId === s.id)) col += bookingBlock(b, (b.start - start) * PX + 1, { leaving: preview.leaving.has(b.id) });
    for (const g of preview.ghosts.filter((x) => x.b.date === date && x.b.staffId === s.id)) {
      const short = (g.b.end - g.b.start) * PX < 44;
      col += `<div class="previewbk ${short ? 'short' : ''}" style="top:${(g.b.start - start) * PX + 1}px;height:${(g.b.end - g.b.start) * PX - 2}px"><b>${esc(g.label)}${short ? ` <span>${hhmm(g.b.start)}</span>` : ''}</b>${short ? '' : `<span>${hhmm(g.b.start)} · ${esc(g.sub)}</span>`}</div>`;
    }
    col += '</div>';
    body += col;
  }
  const nowLine = date === TODAY && NOW > start && NOW < end ? `<div class="nowline" style="top:${(NOW - start) * PX}px;left:56px"></div>` : '';
  return `<div class="day" data-start="${start}">${head}<div class="grid" id="dayGrid" style="grid-template-columns:${cols}">${gutter}${body}${nowLine}</div></div>`;
}

/* ---------- Board: week view ---------- */

function lanes(list) {
  // Side-by-side layout for overlapping blocks in one day column.
  const sorted = list.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const out = new Map();
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds = [];
    const assign = new Map();
    for (const b of cluster) {
      let li = laneEnds.findIndex((e) => e <= b.start);
      if (li < 0) { li = laneEnds.length; laneEnds.push(0); }
      laneEnds[li] = b.end;
      assign.set(b.id, li);
    }
    for (const b of cluster) out.set(b.id, { left: (assign.get(b.id) / laneEnds.length) * 100, width: 100 / laneEnds.length });
    cluster = [];
  };
  for (const b of sorted) {
    if (b.start >= clusterEnd && cluster.length) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  if (cluster.length) flush();
  return out;
}

function renderWeek() {
  const st = S();
  const ws = startOfWeek(ui.date);
  const days = [0, 1, 2, 3, 4, 5].map((i) => addDays(ws, i));
  const { start, end } = dayBounds(days);
  const height = (end - start) * PX;
  const cols = `56px repeat(6, minmax(120px, 1fr))`;
  let head = `<div class="grid-head" style="grid-template-columns:${cols}"><div></div>`;
  for (const d of days) {
    const stats = dayStats(st, d);
    head += `<div class="col-head" data-open-day="${d}"><b>${DAY_SHORT[weekday(d)]} ${toDate(d).getUTCDate()}${d === TODAY ? ' <span style="color:var(--warn);font-weight:500">· today</span>' : ''}</b><small>${stats.count} appts · ${Math.round(stats.utilisation * 100)}%</small><div class="bar"><i style="width:${Math.round(stats.utilisation * 100)}%"></i></div></div>`;
  }
  head += '</div>';
  let gutter = `<div class="gutter" style="height:${height}px">`;
  for (let t = start + 60; t < end; t += 60) gutter += `<span style="top:${(t - start) * PX}px">${hhmm(t)}</span>`;
  gutter += '</div>';
  let body = '';
  for (const d of days) {
    const h = studioHours(st, d);
    let col = `<div class="col" style="height:${height}px">`;
    for (let t = start; t < end; t += 60) col += `<div class="hourline" style="top:${(t - start) * PX}px"></div>`;
    if (!h) col += `<div class="offshift" style="top:0;height:${height}px"></div>`;
    else {
      if (h.start > start) col += `<div class="offshift" style="top:0;height:${(h.start - start) * PX}px"></div>`;
      if (h.end < end) col += `<div class="offshift" style="top:${(h.end - start) * PX}px;height:${(end - h.end) * PX}px"></div>`;
    }
    const list = activeBookings(st, d).filter((b) => !ui.hidden.has(b.staffId));
    const lane = lanes(list);
    for (const b of list) col += bookingBlock(b, (b.start - start) * PX + 1, { lane: lane.get(b.id), week: true });
    col += '</div>';
    body += col;
  }
  const nowLine = days.includes(TODAY) && NOW > start && NOW < end ? `<div class="nowline" style="top:${(NOW - start) * PX}px;left:calc(56px + (100% - 56px) / 6 * ${days.indexOf(TODAY)});right:auto;width:calc((100% - 56px) / 6)"></div>` : '';
  return `<div class="week">${head}<div class="grid" style="grid-template-columns:${cols}">${gutter}${body}${nowLine}</div></div>`;
}

/* ---------- Board: agenda ---------- */

function renderAgenda() {
  const st = S();
  const i = I();
  let html = '<div class="agenda">';
  for (let k = 0; k < 7; k++) {
    const d = addDays(ui.date, k);
    if (!studioHours(st, d)) continue;
    const list = st.bookings.filter((b) => b.date === d && !ui.hidden.has(b.staffId)).sort((a, b) => a.start - b.start || a.staffId.localeCompare(b.staffId));
    const stats = dayStats(st, d);
    html += `<h2>${esc(prettyDate(d, TODAY))}${['Today', 'Tomorrow'].includes(prettyDate(d, TODAY)) ? ` <span style="color:var(--muted);font-weight:500">${esc(prettyDate(d))}</span>` : ''}<small>${stats.count} appts · ${Math.round(stats.utilisation * 100)}% · ${st.catalog.studio.currency}${stats.revenue}</small></h2><table>`;
    if (!list.length) html += '<tr><td colspan="4" style="color:var(--muted)">No appointments yet.</td></tr>';
    for (const b of list) {
      const s = i.staff[b.staffId];
      html += `<tr class="${b.status}" data-booking="${b.id}" style="cursor:pointer"><td class="t">${hhmm(b.start)}–${hhmm(b.end)}</td><td><b>${esc(i.client[b.clientId].name)}</b><br><span style="color:var(--muted);font-size:12.5px">${esc(i.service[b.serviceId].name)} · ${esc(i.room[b.roomId]?.name || '')}</span></td><td class="s"><span class="chip"><i style="background:${s.color}"></i>${esc(s.first)}</span></td><td style="text-align:right"><span class="st ${b.status}">${b.status === 'pending' ? 'awaiting reply' : b.status}</span></td></tr>`;
    }
    html += '</table>';
  }
  return html + '</div>';
}

function renderBoard() {
  const board = $('#board');
  const scroll = board.scrollTop;
  board.innerHTML = ui.view === 'week' ? renderWeek() : ui.view === 'agenda' ? renderAgenda() : renderDay();
  board.scrollTop = scroll;
  if (ui.flash.size) setTimeout(() => ui.flash.clear(), 1500);
}

function scrollToNow() {
  const board = $('#board');
  const day = board.querySelector('[data-start]');
  const start = day ? Number(day.dataset.start) : 7 * 60;
  const target = ui.date === TODAY ? Math.max(start, NOW - 90) : start;
  board.scrollTop = (target - start) * PX;
}

/* ---------- Assistant thread ---------- */

function understoodChips(intent) {
  const i = I();
  const chips = [`<span class="lab">Understood as</span><span class="pill k">${esc(intent.intent || '?')}</span>`];
  if (intent.client_id) chips.push(`<span class="pill">${esc(i.client[intent.client_id]?.name)}</span>`);
  if (intent.staff_id) chips.push(`<span class="pill">${esc(i.staff[intent.staff_id]?.first)}</span>`);
  if (intent.service_id) chips.push(`<span class="pill">${esc(i.service[intent.service_id]?.short)}</span>`);
  const w = intent.when || {};
  if (w.date) chips.push(`<span class="pill">${esc(prettyDate(w.date, TODAY))}${w.date_to ? `–${esc(prettyDate(w.date_to))}` : ''}</span>`);
  if (w.time) chips.push(`<span class="pill">${esc(w.time)}</span>`);
  if (w.window) chips.push(`<span class="pill">${esc(w.window.join('–'))}</span>`);
  if (w.after) chips.push(`<span class="pill">after ${esc(w.after)}</span>`);
  if (w.before) chips.push(`<span class="pill">before ${esc(w.before)}</span>`);
  if (intent.target) chips.push(`<span class="pill">→ ${esc([intent.target.date && prettyDate(intent.target.date, TODAY), intent.target.time, intent.target.window && intent.target.window.join('–')].filter(Boolean).join(' '))}</span>`);
  if (intent.shift_minutes) chips.push(`<span class="pill">${intent.shift_minutes > 0 ? '+' : ''}${intent.shift_minutes} min</span>`);
  return `<div class="understood">${chips.join('')}</div>`;
}

function slotRow(item, p, k) {
  const i = I();
  const b = p.booking;
  const done = item.done === k;
  const disabled = item.done != null;
  const scoreBar = p.parts?.length
    ? `<div class="scorebar" title="Score ${p.score}/100">${p.parts.map((x) => `<i style="width:${x.weight * x.value}%;background:${COLORS[x.key]}"></i>`).join('')}</div>`
    : '';
  const why = p.parts?.length ? `<div class="why">${p.parts.map((x) => `<div class="why-row"><i style="background:${COLORS[x.key]}"></i><span>${esc(x.label)}</span><span>${Math.round(x.weight * x.value)}/${x.weight}</span></div>`).join('')}</div>` : '';
  const label = p.action.type === 'move' ? 'Move here' : p.needsClient ? 'Use slot' : 'Book';
  return `<div class="slot ${item.open === k ? 'open' : ''}" data-item="${item.id}" data-k="${k}">
    <div><div class="when">${esc(prettyDate(b.date, TODAY))} <span class="num">${hhmm(b.start)}</span></div><div class="who">${esc(i.staff[b.staffId].first)} · ${esc(i.room[b.roomId]?.name || '')}${p.exact ? ' · exactly as asked' : ''}</div>${scoreBar}</div>
    <div class="slot-actions">${p.score != null ? `<button class="link" data-why="${k}" data-item="${item.id}" style="font-size:12px">${p.score}/100</button>` : ''}${done ? '<span class="done-note">Done</span>' : `<button class="primary" data-confirm="${k}" data-item="${item.id}" ${disabled ? 'disabled style="opacity:.4"' : ''}>${label}</button>`}</div>
    ${why}
  </div>`;
}

function planCard(item) {
  const r = item.res;
  const i = I();
  const t = r.plan.totals;
  const nv = r.naive.totals;
  const rows = r.plan.rows.map((row) => {
    const o = row.orig;
    const n = row.next;
    return `<div class="plan-row">
      <div class="head"><b>${esc(i.client[o.clientId].name)}</b><span class="mono" style="color:var(--muted);font-size:12px">${esc(i.service[o.serviceId].short)}</span></div>
      <div class="move"><span class="from">${esc(prettyDate(o.date, TODAY))} ${hhmm(o.start)} ${esc(i.staff[o.staffId].first)}</span><span class="arrow">→</span>${n ? `<span class="to">${esc(prettyDate(n.date, TODAY))} ${hhmm(n.start)} ${esc(i.staff[n.staffId].first)}</span>` : '<span class="to none">Call client · priority waitlist</span>'}</div>
      ${row.ripple ? `<div class="ripple">Makes room by asking ${esc(i.client[row.ripple.orig.clientId].name)} (flexible) to shift ${hhmm(row.ripple.orig.start)} → ${hhmm(row.ripple.next.start)}</div>` : ''}
      <details><summary>Message to ${esc(i.client[o.clientId].name.split(' ')[0])} (${esc(i.client[o.clientId].channel)})</summary><div class="sms">${esc(row.message)}</div>${row.ripple ? `<div class="sms">${esc(row.ripple.message)}</div>` : ''}</details>
    </div>`;
  }).join('');
  const cmp = (label, a, b, lowerBetter = false) => `<tr><td>${label}</td><td class="${(lowerBetter ? a < b : a > b) ? 'better' : ''}">${a}</td><td>${b}</td></tr>`;
  const compare = t.affected
    ? `<table class="compare"><tr><th></th><th>This plan</th><th>First free slot</th></tr>
      ${cmp('Kept same day', t.sameDay, nv.sameDay)}
      ${cmp('With their usual therapist', t.usualTherapist, nv.usualTherapist)}
      ${cmp('Need a phone call', t.unresolved, nv.unresolved, true)}
      ${cmp('Disruption score', t.cost, nv.cost, true)}
    </table>`
    : '';
  const done = item.done != null;
  return `${rows ? `<div class="plan-rows">${rows}</div>` : ''}${compare}<div class="plan-foot">${done ? '<span class="done-note">Applied. Messages are in the Outbox.</span>' : `<button class="primary" data-plan="${item.id}">${t.affected ? `Approve plan · queue ${t.affected + t.flexibleShifts} messages` : 'Block the time'}</button><button class="ghost" data-dismiss="${item.id}">Dismiss</button>`}</div>`;
}

function renderThread() {
  const el = $('#thread');
  if (!ui.thread.length) {
    el.innerHTML = `<div class="empty-state">
      <h2>Tell me what needs to happen. I'll find a safe slot.</h2>
      <p>Type like you'd tell a colleague. I propose; you confirm. Rules like "no double bookings" are checked in code, not left to the AI.</p>
      <div class="examples">${EXAMPLES.slice(0, 7).map((e) => `<button data-example="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    </div>`;
    return;
  }
  el.innerHTML = ui.thread.map((item) => {
    if (item.role === 'user') return `<div class="msg-user">${esc(item.text)}</div>`;
    if (item.role === 'note') return `<div class="card"><p class="say">${esc(item.text)}</p>${item.offers ? offersHtml(item) : ''}</div>`;
    const r = item.res;
    let inner = `<p class="say ${r.kind === 'blocked' ? 'warn' : ''}">${esc(r.say)}</p>`;
    if (r.intent?.intent) inner = understoodChips(r.intent) + inner;
    if (r.violations?.length) inner += `<ul class="viol">${r.violations.map((v) => `<li><code>${esc(v.code)}</code>${esc(v.message)}</li>`).join('')}</ul>`;
    if (r.kind === 'clarify' && r.choices?.length) inner += `<div class="choices">${r.choices.map((c, k) => `<button data-choice="${k}" data-item="${item.id}" ${item.done != null ? 'disabled' : ''}>${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</button>`).join('')}</div>`;
    if (r.kind === 'help') inner += `<div class="examples">${r.examples.map((e) => `<button data-example="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
    if (r.kind === 'plan') inner += planCard(item);
    else if (r.kind === 'offers') inner += offersHtml(item);
    else if (r.proposals?.length) {
      if (r.kind === 'single') {
        const p = r.proposals[0];
        inner += item.done != null ? '<span class="done-note">Done</span>' : `<div class="plan-foot"><button class="${p.danger ? 'danger' : 'primary'}" data-confirm="0" data-item="${item.id}">${p.action.type === 'cancel' ? 'Cancel appointment' : p.action.type === 'waitlist' ? 'Add to waitlist' : 'Confirm'}</button><button class="ghost" data-dismiss="${item.id}">Keep as is</button></div>`;
      } else {
        inner += r.proposals.map((p, k) => slotRow(item, p, k)).join('');
      }
    }
    if (r.kind === 'list') inner += listHtml(r.items);
    if (r.waitlistAction && item.done == null) inner += `<div class="plan-foot" style="margin-top:8px"><button class="ghost" data-waitlist="${item.id}">Add to waitlist instead</button></div>`;
    if (r.followUp) inner += `<div class="followup">${esc(r.followUp)}</div>`;
    if (item.dismissed) inner += '<div class="followup">Dismissed. Nothing changed.</div>';
    if (r.intent) inner += `<details class="json"><summary>Intent JSON (same shape the Claude adapter returns)</summary><pre>${esc(JSON.stringify(r.intent, null, 2))}</pre></details>`;
    return `<div class="card">${inner}</div>`;
  }).join('');
  // Show the start of the newest reply, not its end: the answer is at the top of the card.
  const cards = el.querySelectorAll('.card');
  const last = cards[cards.length - 1];
  const lastUser = [...el.querySelectorAll('.msg-user')].pop();
  const anchor = lastUser || last;
  if (anchor) el.scrollTop = Math.max(0, anchor.offsetTop - el.offsetTop - 8);
}

function offersHtml(item) {
  const offers = item.offers || item.res.proposals;
  const i = I();
  const rows = offers.map((o) => `<div class="slot"><div><div class="when">${esc(i.client[o.entry.clientId].name)}</div><div class="who">${esc(i.service[o.booking.serviceId].short)} · ${esc(prettyDate(o.booking.date, TODAY))} ${hhmm(o.booking.start)} with ${esc(i.staff[o.booking.staffId].first)}${o.entry.priority ? ' · priority' : ''}</div></div><div class="slot-actions"></div></div>`).join('');
  const done = item.done != null;
  return `${rows}<div class="plan-foot" style="margin-top:8px">${done ? '<span class="done-note">Offers sent. Slots held as “offered” until they reply.</span>' : `<button class="primary" data-offers="${item.id}">Offer ${offers.length === 1 ? 'it' : `all ${offers.length}`} · hold as pending</button><button class="ghost" data-dismiss="${item.id}">Not now</button>`}</div>`;
}

function listHtml(items) {
  const i = I();
  if (!items.length) return '<div class="followup">Nothing booked.</div>';
  return items.map((b) => `<div class="slot"><div><div class="when"><span class="num">${hhmm(b.start)}</span> ${esc(i.client[b.clientId].name)}</div><div class="who">${esc(i.service[b.serviceId].short)} · ${esc(i.staff[b.staffId].first)} · ${esc(prettyDate(b.date, TODAY))}</div></div><div class="slot-actions"><button class="link" data-show="${b.id}">Show</button></div></div>`).join('');
}

/* ---------- Outbox & log ---------- */

function renderOutbox() {
  const el = $('#pane-outbox');
  $('#outboxCount').textContent = ui.outbox.length || '';
  if (!ui.outbox.length) {
    el.innerHTML = '<div class="muted-empty"><b>No messages queued</b>When you approve a reschedule or a waitlist offer, the drafted WhatsApp/SMS messages appear here. In this demo nothing is actually sent.</div>';
    return;
  }
  el.innerHTML = `<p class="hint" style="margin:0 0 10px">Drafts queued for approval. In production these go out through WhatsApp or SMS; here nothing leaves your browser.</p>` + ui.outbox.map((m) => `<div class="outbox-item"><header><b>${esc(m.to)}</b><span>${esc(m.channel)} · ${esc(m.at)}</span></header><p>${esc(m.text)}</p></div>`).join('');
}

function renderLog() {
  const log = S().log;
  $('#pane-log').innerHTML = log.length
    ? log.map((l) => `<div class="log-item"><span class="who ${l.actor}">${esc(l.actor)}</span>${esc(l.text)}<small>${esc(l.at)}</small></div>`).join('')
    : '<div class="muted-empty"><b>No changes yet</b>Every booking, move and cancellation is recorded here with who made it: a person or the assistant.</div>';
}

function render() {
  renderHeader();
  renderRail();
  renderBoard();
  renderThread();
  renderOutbox();
  renderLog();
}

/* ---------- Actions ---------- */

let toastTimer;
function toast(text, bad = false, undo = false) {
  const t = $('#toast');
  t.className = `toast ${bad ? 'bad' : ''}`;
  t.innerHTML = `${esc(text)}${undo ? '<button class="link" data-undo>Undo</button>' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 5200 : 3800);
}

function apply(action, actor = 'assistant') {
  const r = history.commit(action, actor);
  if (r.error) {
    toast(`Blocked by guardrail: ${r.error[0].message}`, true);
    return null;
  }
  const ids = (r.results || [r]).map((x) => x.booking?.id).filter(Boolean);
  ids.forEach((id) => ui.flash.add(id));
  return r;
}

function showBooking(id) {
  const b = S().bookings.find((x) => x.id === id);
  if (!b) return;
  ui.date = b.date;
  if (ui.view === 'agenda') ui.view = 'day';
  ui.flash.add(b.id);
  setMobile('board');
  render();
  const el = document.querySelector(`[data-booking="${id}"]`);
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

let seq = 0;
function ask(text) {
  if (!text.trim()) return;
  ui.thread.push({ id: `u${++seq}`, role: 'user', text });
  const res = respond(S(), text);
  ui.thread.push({ id: `a${++seq}`, role: 'assistant', res, done: null });
  if (res.kind === 'plan') {
    ui.date = res.plan.disruption.date;
    if (ui.view === 'agenda') ui.view = 'day';
  } else if (res.kind === 'blocked' && res.parsed?.when?.date) {
    if (ui.view !== 'agenda') ui.date = res.parsed.when.date;
  } else if (res.target && ui.view === 'day') {
    ui.date = res.target.date;
  } else if (res.proposals?.[0]?.booking && res.kind !== 'list') {
    const d = res.proposals[0].booking.date;
    if (ui.view === 'day') ui.date = d;
  } else if (res.kind === 'list' && res.date) ui.date = res.date;
  setTab('assistant');
  render();
}

function itemById(id) {
  return ui.thread.find((x) => x.id === id);
}

function confirmProposal(item, k) {
  const p = item.res.proposals[k];
  let action = p.action;
  if (p.needsClient) {
    $('#input').value = `Book  with ${I().staff[p.booking.staffId].first} ${dayWord(p.booking.date)} at ${fmt12(p.booking.start)}`;
    $('#input').focus();
    $('#input').setSelectionRange(5, 5);
    toast('Type the client\'s name to book this slot.');
    return;
  }
  const r = apply(action);
  if (!r) return;
  item.done = k;
  const b = r.booking;
  if (action.type === 'cancel') {
    toast(`Cancelled ${I().client[b.clientId].name}`, false, true);
    const offers = waitlistOffers(S(), { date: b.date, start: b.start - 15, end: b.end + 30, excludeClient: b.clientId });
    if (offers.length) ui.thread.push({ id: `n${++seq}`, role: 'note', text: `${offers.length === 1 ? 'Someone' : `${offers.length} people`} on the waitlist can take the freed time:`, offers, done: null });
  } else if (action.type === 'waitlist') {
    toast('Added to the waitlist', false, true);
  } else if (b) {
    toast(`${action.type === 'move' ? 'Moved' : 'Booked'} ${I().client[b.clientId].name} · ${prettyDate(b.date, TODAY)} ${hhmm(b.start)}`, false, true);
    ui.date = b.date;
  }
  render();
}

function approvePlan(item) {
  const r = apply(item.res.action);
  if (!r) return;
  item.done = 0;
  const i = I();
  const at = `${prettyDate(TODAY)} ${hhmm(NOW)}`;
  for (const row of item.res.plan.rows) {
    ui.outbox.unshift({ to: i.client[row.orig.clientId].name, channel: i.client[row.orig.clientId].channel, text: row.message, at });
    if (row.ripple) ui.outbox.unshift({ to: i.client[row.ripple.orig.clientId].name, channel: i.client[row.ripple.orig.clientId].channel, text: row.ripple.message, at });
  }
  const t = item.res.plan.totals;
  toast(t.affected ? `Plan applied: ${t.rehoused} moved, ${t.unresolved} to call. ${t.affected + t.flexibleShifts} messages queued.` : 'Time blocked.', false, true);
  render();
}

function sendOffers(item) {
  const offers = item.offers || item.res.proposals;
  const action = item.res?.action || { type: 'plan', steps: offers.map((o) => o.action), note: 'Offered freed slot to the waitlist' };
  const r = apply(action);
  if (!r) return;
  item.done = 0;
  const i = I();
  const at = `${prettyDate(TODAY)} ${hhmm(NOW)}`;
  for (const o of offers) {
    const c = i.client[o.entry.clientId];
    ui.outbox.unshift({ to: c.name, channel: c.channel, text: `Hi ${c.name.split(' ')[0]}, a ${i.service[o.booking.serviceId].name.toLowerCase()} slot opened ${dayWord(o.booking.date)} at ${fmt12(o.booking.start)} with ${i.staff[o.booking.staffId].first}. We're holding it for you for 2 hours. Reply YES to take it. Lëvizja`, at });
  }
  toast(`${offers.length} offer${offers.length === 1 ? '' : 's'} queued`, false, true);
  render();
}

/* ---------- Booking popover ---------- */

function openPop(id, anchor) {
  const b = S().bookings.find((x) => x.id === id);
  if (!b) return;
  const i = I();
  const c = i.client[b.clientId];
  const svc = i.service[b.serviceId];
  const past = b.date < TODAY || (b.date === TODAY && b.end <= NOW);
  const pop = $('#pop');
  pop.innerHTML = `<h4>${esc(c.name)}</h4><div class="sub">${esc(svc.name)} · ${S().catalog.studio.currency}${svc.price}</div>
    <dl><dt>When</dt><dd>${esc(prettyDate(b.date, TODAY))}, <span class="mono">${hhmm(b.start)}–${hhmm(b.end)}</span></dd>
    <dt>With</dt><dd>${esc(i.staff[b.staffId].name)}</dd><dt>Room</dt><dd>${esc(i.room[b.roomId]?.name || '')}</dd>
    <dt>Status</dt><dd>${b.status === 'pending' ? 'Waiting for the client to confirm' : esc(b.status)}${b.movedFrom ? `<br><small style="color:var(--muted)">was ${esc(prettyDate(b.movedFrom.date, TODAY))} ${hhmm(b.movedFrom.start)} with ${esc(i.staff[b.movedFrom.staffId].first)}</small>` : ''}</dd>
    <dt>Prefers</dt><dd>${esc(c.prefers?.staff ? i.staff[c.prefers.staff].first : 'anyone')}, ${esc(c.prefers?.window || 'any time')}${c.flexible ? ' · flexible' : ''}</dd>
    <dt>Contact</dt><dd>${esc(c.channel)}</dd></dl>
    ${past || b.status === 'cancelled' ? '' : `<div class="row">${b.status === 'pending' ? `<button class="primary" data-pop-confirm="${b.id}">Client said yes</button>` : ''}<button class="ghost" data-pop-move="${b.id}">Move…</button><button class="ghost" data-pop-cancel="${b.id}" style="color:var(--warn)">Cancel</button></div>`}`;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = 300;
  let left = r.right + 8;
  if (left + w > innerWidth - 8) left = Math.max(8, r.left - w - 8);
  const top = Math.min(Math.max(8, r.top), innerHeight - pop.offsetHeight - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function closePop() { $('#pop').hidden = true; }

/* ---------- Drag to move ---------- */

let drag = null;

function onPointerDown(e) {
  const el = e.target.closest('.bk');
  if (!el || e.button !== 0) return;
  const id = el.dataset.booking;
  const inDay = !!el.closest('#dayGrid');
  drag = { id, el, x: e.clientX, y: e.clientY, moved: false, inDay, past: !!el.dataset.past, offsetY: e.clientY - el.getBoundingClientRect().top };
  if (inDay && !drag.past) el.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!drag || !drag.inDay || drag.past) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
  drag.moved = true;
  drag.el.classList.add('dragging');
  closePop();
  const grid = $('#dayGrid');
  const cols = [...grid.querySelectorAll('.col')];
  const col = cols.find((c) => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; }) || cols[0];
  const start = Number(grid.parentElement.dataset.start);
  const rect = col.getBoundingClientRect();
  let minute = start + Math.round(((e.clientY - drag.offsetY - rect.top) / PX) / 15) * 15;
  const b = S().bookings.find((x) => x.id === drag.id);
  const staffId = col.dataset.col;
  const { booking, violations } = prepare(S(), { ...b, staffId, start: minute, end: undefined, roomId: staffId === b.staffId ? b.roomId : undefined });
  drag.target = { staffId, start: minute, ok: !violations.length, violations, roomId: booking.roomId };
  let g = grid.querySelector('.ghostbk');
  if (!g) { g = document.createElement('div'); g.className = 'ghostbk'; }
  if (g.parentElement !== col) col.appendChild(g);
  g.classList.toggle('bad', !!violations.length);
  g.style.top = `${(minute - start) * PX}px`;
  g.style.height = `${(b.end - b.start) * PX - 2}px`;
  g.innerHTML = `<b>${hhmm(minute)}–${hhmm(minute + b.end - b.start)}</b><span>${violations.length ? esc(violations[0].message) : `Safe · ${esc(I().room[booking.roomId]?.name || '')}`}</span>`;
}

function onPointerUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.querySelectorAll('.ghostbk').forEach((g) => g.remove());
  d.el.classList.remove('dragging');
  if (!d.moved) {
    openPop(d.id, d.el);
    return;
  }
  const b = S().bookings.find((x) => x.id === d.id);
  if (!d.target || (d.target.staffId === b.staffId && d.target.start === b.start)) { renderBoard(); return; }
  if (!d.target.ok) {
    toast(`Blocked by guardrail: ${d.target.violations[0].message}`, true);
    renderBoard();
    return;
  }
  const r = apply({ type: 'move', id: d.id, to: { staffId: d.target.staffId, start: d.target.start, roomId: d.target.roomId } }, 'staff');
  if (r) toast(`Moved ${I().client[b.clientId].name} to ${hhmm(d.target.start)} with ${I().staff[d.target.staffId].first}`, false, true);
  render();
}

/* ---------- Scenarios ---------- */

function busiestStaff(date) {
  const st = S();
  const counts = st.catalog.staff.filter((s) => s.skills.includes('physio')).map((s) => ({ s, n: activeBookings(st, date).filter((b) => b.staffId === s.id && b.end > (date === TODAY ? NOW : 0)).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].s;
}

function scenarioDay() {
  const d = ui.date >= TODAY && studioHours(S(), ui.date) ? ui.date : firstOpenDay(TODAY);
  return d;
}

const SCENARIOS = [
  { key: 'sick', title: 'A therapist calls in sick', sub: 'Reschedule a whole day in one approval', run: () => { const d = scenarioDay(); return `${busiestStaff(d).first} called in sick ${dayWord(d)}`; } },
  { key: 'double', title: 'Try to double-book', sub: 'Ask for a time that is already taken', run: () => {
    const d = scenarioDay();
    const b = activeBookings(S(), d).filter((x) => x.staffId === 'elira' || x.staffId === 'arben').find((x) => d > TODAY || x.start > NOW + 90);
    if (!b) return `Book Tom Walsh with Arben ${dayWord(d)} at 3pm`;
    const s = I().staff[b.staffId];
    const other = S().catalog.clients.find((c) => !c.virtual && c.id !== b.clientId && S().catalog.usualService[c.id] === 'followup');
    return `Book ${other.name} for a follow-up with ${s.first} ${dayWord(d)} at ${fmt12(b.start)}`;
  } },
  { key: 'cancel', title: 'A client cancels', sub: 'The waitlist is offered the freed slot', run: () => {
    const st = S();
    for (let k = 0; k < 7; k++) {
      const d = addDays(scenarioDay(), k);
      for (const b of activeBookings(st, d).filter((x) => d > TODAY || x.start > NOW + 60)) {
        const offers = waitlistOffers({ ...st, bookings: st.bookings.map((x) => (x.id === b.id ? { ...x, status: 'cancelled' } : x)) }, { date: b.date, start: b.start - 15, end: b.end + 30, excludeClient: b.clientId });
        if (offers.length) return `Cancel ${I().client[b.clientId].name}'s appointment ${dayWord(d)} at ${fmt12(b.start)}`;
      }
    }
    return 'Cancel Giulia\'s next reformer session';
  } },
  { key: 'gaps', title: 'Fill the gaps', sub: 'Offer short free slots to people waiting', run: () => `Fill the gaps ${dayWord(scenarioDay())} from the waitlist` },
  { key: 'albanian', title: 'Ask in Albanian', sub: 'Rezervo Besa për pilates nesër', run: () => 'Rezervo Besa për pilates nesër në 10' },
  { key: 'ambiguous', title: 'An ambiguous name', sub: 'Two clients called Ana', run: () => `Ana needs a follow-up ${dayWord(addDays(scenarioDay(), 1))} morning` },
];

function runScenario(key) {
  const s = SCENARIOS.find((x) => x.key === key);
  if (!s) return;
  $('#scenarioMenu').hidden = true;
  const text = s.run();
  setMobile('side');
  ask(text);
  return text;
}

/* ---------- Evidence modal ---------- */

async function openEvidence() {
  const modal = $('#modal');
  const card = $('#modalCard');
  card.innerHTML = '<p>Loading results…</p>';
  modal.hidden = false;
  try {
    const res = await fetch('data/results.json');
    const r = await res.json();
    const p = r.parser;
    const rp = r.repair;
    card.innerHTML = `<button class="ghost close" data-close>Close</button>
      <h2>How well it works</h2>
      <p>Numbers come from <span class="mono">npm run evaluate</span>, which you can rerun. The command set below was written separately and never used to tune the parser.</p>
      <h3>Understanding requests</h3>
      <table><tr><th>Set</th><th>Commands</th><th>Intent right</th><th>All fields right</th></tr>
      ${p.sets.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.n}</td><td>${(s.intent * 100).toFixed(0)}%</td><td>${(s.exact * 100).toFixed(0)}%</td></tr>`).join('')}</table>
      <p class="note">"All fields right" means intent, client, staff, service, date and time all match the label. Misses on the held-out set: ${p.heldoutMisses.map((m) => `“${esc(m)}”`).join(', ') || 'none'}. ${esc(p.history || '')} When the parser isn't sure it asks, and in production the Claude adapter (llm/claude-intent.js) can replace it with the same JSON contract.</p>
      <h3>Rescheduling a sick day</h3>
      <p>${rp.scenarios} simulated absences (${rp.clients} affected clients) on different seeded diaries. Compared with giving each client the first free slot in diary order:</p>
      <table><tr><th></th><th>This planner</th><th>First free slot</th></tr>
      ${rp.rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${esc(x.ours)}</td><td>${esc(x.naive)}</td></tr>`).join('')}</table>
      <p class="note">${esc(rp.note)}</p>
      <h3>Guardrails</h3>
      <p>${r.guardrails.attempts} random unsafe bookings (double bookings, wrong room, off-shift, unqualified staff, equipment clashes) were thrown at the store. Saved: ${r.guardrails.saved}. Every rule has its own test in <span class="mono">tests/</span>.</p>`;
  } catch (err) {
    card.innerHTML = `<button class="ghost close" data-close>Close</button><h2>How well it works</h2><p>Run <span class="mono">npm run evaluate</span> to produce data/results.json.</p>`;
  }
}

/* ---------- Wiring ---------- */

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  for (const t of ['assistant', 'outbox', 'log']) $(`#pane-${t}`).hidden = t !== tab;
}

function setMobile(which) {
  ui.mobile = which;
  $('.shell').dataset.mobile = which;
  document.querySelectorAll('[data-mobile]').forEach((b) => b.classList.toggle('on', b.dataset.mobile === which));
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-hit], [data-booking], [data-toggle-staff], [data-open-day]');
  if (!t) {
    if (!e.target.closest('#pop')) closePop();
    if (!e.target.closest('.menu')) $('#scenarioMenu').hidden = true;
    return;
  }
  const ds = t.dataset;
  if (ds.nav) {
    if (ds.nav === 'today') ui.date = firstOpenDay(TODAY);
    else ui.date = addDays(ui.date, Number(ds.nav) * (ui.view === 'week' ? 7 : 1));
    render();
    if (ui.view === 'day') scrollToNow();
  } else if (ds.view) { ui.view = ds.view; render(); if (ds.view !== 'agenda') scrollToNow(); }
  else if (ds.date) { ui.date = ds.date; if (ui.view === 'agenda') ui.view = 'day'; render(); setMobile('board'); }
  else if (ds.month) { const d = toDate(ui.date); d.setUTCMonth(d.getUTCMonth() + Number(ds.month), 1); ui.date = d.toISOString().slice(0, 10); render(); }
  else if (ds.toggleStaff) { ui.hidden.has(ds.toggleStaff) ? ui.hidden.delete(ds.toggleStaff) : ui.hidden.add(ds.toggleStaff); if (ui.hidden.size === S().catalog.staff.length) ui.hidden.clear(); render(); }
  else if (ds.openDay) { ui.date = ds.openDay; ui.view = 'day'; render(); scrollToNow(); }
  else if (ds.gotoOpen !== undefined) { ui.date = firstOpenDay(addDays(ui.date, 1)); render(); }
  else if (ds.tab) setTab(ds.tab);
  else if (ds.mobile) setMobile(ds.mobile);
  else if (ds.example) { setMobile('side'); ask(ds.example); }
  else if (ds.confirm) confirmProposal(itemById(ds.item), Number(ds.confirm));
  else if (ds.why) { const it = itemById(ds.item); it.open = it.open === Number(ds.why) ? null : Number(ds.why); renderThread(); }
  else if (ds.plan) approvePlan(itemById(ds.plan));
  else if (ds.offers) sendOffers(itemById(ds.offers));
  else if (ds.dismiss) { const it = itemById(ds.dismiss); it.done = -1; it.dismissed = true; renderThread(); }
  else if (ds.choice) {
    const it = itemById(ds.item);
    const c = it.res.choices[Number(ds.choice)];
    it.done = Number(ds.choice);
    if (c.clientId) {
      const res = respond(S(), it.res.text, { clientOverride: c.clientId });
      ui.thread.push({ id: `a${++seq}`, role: 'assistant', res, done: null });
      if (res.proposals?.[0]?.booking) ui.date = res.proposals[0].booking.date;
      render();
    } else if (c.staffId) {
      ask(`${I().staff[c.staffId].first} ${it.res.text}`);
    }
  } else if (ds.waitlist) { const it = itemById(ds.waitlist); const r = apply(it.res.waitlistAction); if (r) { it.done = -1; toast('Added to the waitlist', false, true); render(); } }
  else if (ds.show) showBooking(ds.show);
  else if (ds.undo !== undefined) { history.undo(); toast('Undone'); render(); }
  else if (t.id === 'undoBtn') { history.undo(); toast('Undone'); render(); }
  else if (t.id === 'scenarioBtn') { const m = $('#scenarioMenu'); m.hidden = !m.hidden; }
  else if (ds.scenario) runScenario(ds.scenario);
  else if (t.id === 'evidenceBtn') openEvidence();
  else if (ds.close !== undefined) $('#modal').hidden = true;
  else if (ds.popConfirm) { closePop(); const r = apply({ type: 'confirm', id: ds.popConfirm }, 'staff'); if (r) { toast('Marked as confirmed', false, true); render(); } }
  else if (ds.popMove) {
    closePop();
    const b = S().bookings.find((x) => x.id === ds.popMove);
    $('#input').value = `Move ${I().client[b.clientId].name} ${dayWord(b.date)} at ${fmt12(b.start)} to `;
    setMobile('side');
    setTab('assistant');
    $('#input').focus();
  } else if (ds.popCancel) {
    closePop();
    const b = S().bookings.find((x) => x.id === ds.popCancel);
    setMobile('side');
    ask(`Cancel ${I().client[b.clientId].name}'s appointment ${dayWord(b.date)} at ${fmt12(b.start)}`);
  } else if (ds.hit && !drag) {
    const col = t.closest('.col');
    const grid = $('#dayGrid');
    const start = Number(grid.parentElement.dataset.start);
    const minute = start + Math.floor(((e.clientY - col.getBoundingClientRect().top) / PX) / 15) * 15;
    const s = I().staff[ds.hit];
    $('#input').value = `Book  with ${s.first} ${dayWord(ui.date)} at ${fmt12(minute)}`;
    setMobile('side');
    setTab('assistant');
    $('#input').focus();
    $('#input').setSelectionRange(5, 5);
  } else if (ds.booking && t.tagName === 'TR') openPop(ds.booking, t);
});

$('#board').addEventListener('pointerdown', onPointerDown);
document.addEventListener('pointermove', onPointerMove);
document.addEventListener('pointerup', onPointerUp);

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#input').value;
  $('#input').value = '';
  ask(v);
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== $('#input')) { e.preventDefault(); setMobile('side'); setTab('assistant'); $('#input').focus(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && document.activeElement !== $('#input')) { e.preventDefault(); history.undo(); render(); }
  if (e.key === 'Escape') { closePop(); $('#modal').hidden = true; $('#scenarioMenu').hidden = true; }
});
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });

$('#scenarioMenu').innerHTML = SCENARIOS.map((s) => `<button data-scenario="${s.key}"><b>${esc(s.title)}</b><span>${esc(s.sub)}</span></button>`).join('');

setMobile(innerWidth <= 900 && params.get('pane') ? params.get('pane') : 'board');
render();
scrollToNow();

// Reproducible demos and screenshots: ?run=sick, ?q=..., ?confirm=1 approves the first proposal.
const run = params.get('run');
const q = params.get('q');
if (run || q) {
  if (run) runScenario(run);
  else ask(q);
  if (!params.get('pane')) setMobile(innerWidth <= 900 ? 'side' : 'board');
  else setMobile(params.get('pane'));
  if (params.get('confirm')) {
    const it = ui.thread[ui.thread.length - 1];
    if (it.res.kind === 'plan') approvePlan(it);
    else if (it.res.kind === 'offers') sendOffers(it);
    else if (it.res.proposals?.length) confirmProposal(it, 0);
    if (params.get('then') === 'offers') { const n = ui.thread[ui.thread.length - 1]; if (n.role === 'note') { /* leave visible */ } }
  }
  if (params.get('tab')) setTab(params.get('tab'));
  scrollToNow();
}
if (params.get('evidence')) openEvidence();
window.__orari = { history, ui, ask };
