// Lëvizja Physio & Movement is a fictional physiotherapy and pilates studio in Tirana.
// Every name, client and booking here was written for this demo.

export const studio = {
  name: 'Lëvizja Physio & Movement',
  city: 'Tirana',
  currency: '€',
  slotStep: 15, // minutes between candidate start times
  minLeadMinutes: 60, // the assistant never books a slot starting within the next hour
  hours: {
    // weekday number (0 = Sunday) → [open, close]
    1: ['08:00', '20:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '20:00'],
    4: ['08:00', '20:00'],
    5: ['08:00', '20:00'],
    6: ['09:00', '14:00'],
  },
};

export const services = [
  { id: 'assess', name: 'Physio assessment', short: 'Assessment', minutes: 60, price: 45, skill: 'physio', rooms: ['treatment'], buffer: 10, tone: 'physio',
    aliases: ['assessment', 'initial assessment', 'first appointment', 'first visit', 'new patient', 'physio assessment', 'initial physio', 'evaluation', 'vlerësim'] },
  { id: 'followup', name: 'Physio follow-up', short: 'Follow-up', minutes: 45, price: 35, skill: 'physio', rooms: ['treatment'], buffer: 10, tone: 'physio',
    aliases: ['follow-up', 'follow up', 'followup', 'physio', 'physiotherapy', 'treatment', 'review', 'session', 'fizioterapi'] },
  { id: 'shockwave', name: 'Shockwave therapy', short: 'Shockwave', minutes: 30, price: 40, skill: 'shockwave', rooms: ['treatment'], buffer: 10, equipment: 'shockwave', tone: 'device',
    aliases: ['shockwave', 'shock wave', 'eswt'] },
  { id: 'needling', name: 'Dry needling', short: 'Needling', minutes: 30, price: 35, skill: 'needling', rooms: ['treatment'], buffer: 10, tone: 'physio',
    aliases: ['dry needling', 'needling', 'needles', 'acupuncture'] },
  { id: 'massage', name: 'Sports massage', short: 'Massage', minutes: 60, price: 50, skill: 'massage', rooms: ['massage', 'treatment'], buffer: 15, tone: 'massage',
    aliases: ['sports massage', 'massage', 'deep tissue', 'masazh', 'massaggio'] },
  { id: 'lymph', name: 'Lymphatic drainage', short: 'Lymphatic', minutes: 45, price: 45, skill: 'massage', rooms: ['massage'], buffer: 15, tone: 'massage',
    aliases: ['lymphatic drainage', 'lymphatic', 'drainage'] },
  { id: 'reformer', name: 'Reformer pilates (1:1)', short: 'Reformer', minutes: 55, price: 40, skill: 'pilates', rooms: ['reformer'], buffer: 5, tone: 'pilates',
    aliases: ['reformer', 'pilates', 'reformer pilates', 'pilates session', 'private pilates'] },
  { id: 'pelvic', name: 'Pelvic health assessment', short: 'Pelvic health', minutes: 60, price: 55, skill: 'pelvic', rooms: ['treatment'], buffer: 10, tone: 'physio',
    aliases: ['pelvic health', 'pelvic', 'pelvic floor', 'postnatal', 'women\'s health'] },
];

export const staff = [
  { id: 'elira', name: 'Elira Kola', first: 'Elira', role: 'Physiotherapist', skills: ['physio', 'shockwave', 'massage'], color: '#2f6f5e',
    shifts: { 1: ['08:00', '16:00'], 2: ['08:00', '16:00'], 3: ['08:00', '16:00'], 4: ['08:00', '16:00'], 5: ['08:00', '14:00'] },
    breaks: [{ start: '12:30', end: '13:00' }], maxDailyMinutes: 420 },
  { id: 'arben', name: 'Arben Hoxha', first: 'Arben', role: 'Physiotherapist', skills: ['physio', 'needling', 'shockwave'], color: '#b4532a',
    shifts: { 1: ['11:00', '19:00'], 2: ['11:00', '19:00'], 3: ['12:00', '20:00'], 4: ['11:00', '19:00'], 6: ['09:00', '14:00'] },
    breaks: [{ start: '15:00', end: '15:30' }], maxDailyMinutes: 420 },
  { id: 'jona', name: 'Jona Leka', first: 'Jona', role: 'Physiotherapist', skills: ['physio', 'pelvic', 'needling'], color: '#6b4f8a',
    shifts: { 1: ['09:00', '17:00'], 3: ['09:00', '17:00'], 5: ['09:00', '17:00'], 6: ['09:00', '13:00'] },
    breaks: [{ start: '13:00', end: '13:30' }], maxDailyMinutes: 420 },
  { id: 'marco', name: 'Marco Bellini', first: 'Marco', role: 'Sports massage therapist', skills: ['massage'], color: '#9a7b1f',
    shifts: { 2: ['10:00', '19:00'], 3: ['10:00', '19:00'], 4: ['12:00', '20:00'], 5: ['10:00', '19:00'], 6: ['09:00', '14:00'] },
    breaks: [{ start: '14:00', end: '14:30' }], maxDailyMinutes: 450 },
  { id: 'sara', name: 'Sara Dervishi', first: 'Sara', role: 'Pilates instructor', skills: ['pilates'], color: '#3e6a96',
    shifts: { 1: ['07:30', '13:30'], 2: ['14:00', '20:00'], 3: ['07:30', '13:30'], 4: ['14:00', '20:00'], 5: ['08:00', '14:00'], 6: ['09:00', '13:00'] },
    breaks: [], maxDailyMinutes: 360 },
];

export const rooms = [
  { id: 't1', name: 'Room 1', type: 'treatment' },
  { id: 't2', name: 'Room 2', type: 'treatment' },
  { id: 't3', name: 'Room 3', type: 'treatment' },
  { id: 'm1', name: 'Garden room', type: 'massage' },
  { id: 'r1', name: 'Studio', type: 'reformer' },
];

export const equipment = [{ id: 'shockwave', name: 'Shockwave unit', count: 1 }];

// window: the part of the day the client prefers. flexible: the client agreed to be moved to an
// earlier or later slot on the same day if it helps the studio (used by "tidy the day").
export const clients = [
  { id: 'c01', name: 'Ana Berisha', prefers: { staff: 'elira', window: 'morning' }, channel: 'WhatsApp', flexible: true },
  { id: 'c02', name: 'Ana Marku', prefers: { staff: 'jona', window: 'afternoon' }, channel: 'SMS' },
  { id: 'c03', name: 'Dritan Shehu', prefers: { staff: 'arben', window: 'evening' }, channel: 'WhatsApp' },
  { id: 'c04', name: 'Luca Ferri', prefers: { staff: 'marco', window: 'evening' }, channel: 'email' },
  { id: 'c05', name: 'Besa Gashi', prefers: { staff: 'sara', window: 'morning' }, channel: 'WhatsApp', flexible: true },
  { id: 'c06', name: 'Klajdi Muça', prefers: { staff: 'arben', window: 'afternoon' }, channel: 'WhatsApp' },
  { id: 'c07', name: 'Giulia Romano', prefers: { staff: 'sara', window: 'evening' }, channel: 'email' },
  { id: 'c08', name: 'Erion Bajrami', prefers: { staff: 'elira', window: 'morning' }, channel: 'SMS', flexible: true },
  { id: 'c09', name: 'Mirela Topi', prefers: { staff: 'jona', window: 'morning' }, channel: 'WhatsApp' },
  { id: 'c10', name: 'Tom Walsh', prefers: { staff: 'arben', window: 'evening' }, channel: 'email' },
  { id: 'c11', name: 'Albana Hysa', prefers: { staff: 'marco', window: 'afternoon' }, channel: 'WhatsApp', flexible: true },
  { id: 'c12', name: 'Sokol Leka', prefers: { staff: 'elira', window: 'afternoon' }, channel: 'SMS' },
  { id: 'c13', name: 'Francesca Conti', prefers: { staff: 'sara', window: 'morning' }, channel: 'email' },
  { id: 'c14', name: 'Ilir Prifti', prefers: { staff: 'arben', window: 'afternoon' }, channel: 'WhatsApp' },
  { id: 'c15', name: 'Rina Kastrati', prefers: { staff: 'jona', window: 'morning' }, channel: 'WhatsApp', flexible: true },
  { id: 'c16', name: 'Matteo Greco', prefers: { staff: 'marco', window: 'evening' }, channel: 'email' },
  { id: 'c17', name: 'Elona Duka', prefers: { staff: 'elira', window: 'morning' }, channel: 'WhatsApp' },
  { id: 'c18', name: 'Genti Zeneli', prefers: { staff: 'arben', window: 'evening' }, channel: 'SMS', flexible: true },
  { id: 'c19', name: 'Hannah Price', prefers: { staff: 'sara', window: 'evening' }, channel: 'email' },
  { id: 'c20', name: 'Blerina Cela', prefers: { staff: 'jona', window: 'afternoon' }, channel: 'WhatsApp' },
  { id: 'c21', name: 'Arta Rama', prefers: { staff: 'elira', window: 'afternoon' }, channel: 'WhatsApp', flexible: true },
  { id: 'c22', name: 'Paolo Ricci', prefers: { staff: 'marco', window: 'afternoon' }, channel: 'email' },
  { id: 'c23', name: 'Kevin Malaj', prefers: { staff: 'arben', window: 'evening' }, channel: 'WhatsApp' },
  { id: 'c24', name: 'Ornela Basha', prefers: { staff: 'sara', window: 'morning' }, channel: 'WhatsApp' },
  { id: 'c25', name: 'Fatjon Kurti', prefers: { staff: 'elira', window: 'morning' }, channel: 'SMS' },
  { id: 'c26', name: 'Sofia Marino', prefers: { staff: 'jona', window: 'morning' }, channel: 'email', flexible: true },
  { id: 'c27', name: 'Endri Lika', prefers: { staff: 'marco', window: 'evening' }, channel: 'WhatsApp' },
  { id: 'c28', name: 'Daniela Vata', prefers: { staff: 'elira', window: 'afternoon' }, channel: 'WhatsApp' },
  { id: 'c29', name: 'James Carter', prefers: { staff: 'arben', window: 'afternoon' }, channel: 'email' },
  { id: 'c30', name: 'Megi Hoti', prefers: { staff: 'sara', window: 'evening' }, channel: 'WhatsApp', flexible: true },
  { id: 'c31', name: 'Ardit Kola', prefers: { staff: 'jona', window: 'afternoon' }, channel: 'SMS' },
  { id: 'c32', name: 'Chiara Bruno', prefers: { staff: 'marco', window: 'morning' }, channel: 'email' },
  { id: 'c33', name: 'Redon Meta', prefers: { staff: 'arben', window: 'evening' }, channel: 'WhatsApp' },
  { id: 'c34', name: 'Valbona Isufi', prefers: { staff: 'elira', window: 'morning' }, channel: 'WhatsApp' },
  { id: 'c35', name: 'Nina Spahiu', prefers: { staff: 'sara', window: 'afternoon' }, channel: 'WhatsApp' },
  { id: 'c36', name: 'Oliver Hughes', prefers: { staff: 'marco', window: 'evening' }, channel: 'email', flexible: true },
  { id: 'c37', name: 'Lorenc Dibra', prefers: { staff: 'arben', window: 'afternoon' }, channel: 'WhatsApp', flexible: true },
  { id: 'c38', name: 'Silvia Esposito', prefers: { staff: 'elira', window: 'morning' }, channel: 'email' },
  { id: 'c39', name: 'Bujar Rexha', prefers: { staff: 'marco', window: 'evening' }, channel: 'SMS' },
  { id: 'c40', name: 'Emma Clarke', prefers: { staff: 'sara', window: 'morning' }, channel: 'email' },
  { id: 'c41', name: 'Teuta Mema', prefers: { staff: 'jona', window: 'morning' }, channel: 'WhatsApp', flexible: true },
  { id: 'c42', name: 'Andi Gjoka', prefers: { staff: 'arben', window: 'evening' }, channel: 'WhatsApp' },
  { id: 'c43', name: 'Laura Colombo', prefers: { staff: 'elira', window: 'afternoon' }, channel: 'email' },
  { id: 'c44', name: 'Xhoni Pepa', prefers: { staff: 'marco', window: 'afternoon' }, channel: 'WhatsApp' },
  { id: 'c45', name: 'Kejsi Alia', prefers: { staff: 'sara', window: 'evening' }, channel: 'WhatsApp', flexible: true },
  { id: 'c46', name: 'Pietro Gallo', prefers: { staff: 'arben', window: 'afternoon' }, channel: 'email' },
  { id: 'c47', name: 'Enkeleda Ruci', prefers: { staff: 'jona', window: 'afternoon' }, channel: 'SMS' },
  { id: 'c48', name: 'Ben Turner', prefers: { staff: 'elira', window: 'morning' }, channel: 'email' },
  { id: 'c49', name: 'Orges Brahimi', prefers: { staff: 'marco', window: 'evening' }, channel: 'WhatsApp', flexible: true },
  { id: 'c50', name: 'Alessia Fontana', prefers: { staff: 'sara', window: 'afternoon' }, channel: 'email' },
  { id: 'c51', name: 'Gerti Sula', prefers: { staff: 'arben', window: 'evening' }, channel: 'WhatsApp' },
  { id: 'c52', name: 'Lindita Nika', prefers: { staff: 'elira', window: 'morning' }, channel: 'WhatsApp' },
  { id: 'c53', name: 'Marsela Gjini', prefers: { staff: 'jona', window: 'morning' }, channel: 'SMS', flexible: true },
  { id: 'c54', name: 'Davide Moretti', prefers: { staff: 'marco', window: 'afternoon' }, channel: 'email' },
  { id: 'c55', name: 'Eralda Shkurti', prefers: { staff: 'sara', window: 'morning' }, channel: 'WhatsApp' },
  { id: 'c56', name: 'Florian Ndoja', prefers: { staff: 'arben', window: 'afternoon' }, channel: 'WhatsApp' },
  { id: 'c57', name: 'Rebecca Hall', prefers: { staff: 'elira', window: 'afternoon' }, channel: 'email', flexible: true },
  { id: 'c58', name: 'Aurel Tafa', prefers: { staff: 'jona', window: 'afternoon' }, channel: 'WhatsApp' },
  { id: 'c59', name: 'Irena Koçi', prefers: { staff: 'sara', window: 'evening' }, channel: 'WhatsApp' },
  { id: 'c60', name: 'Simone De Luca', prefers: { staff: 'marco', window: 'evening' }, channel: 'email' },
];

// The service each client usually books, used when the request doesn't name one
// ("book Dritan for Thursday" means his usual follow-up).
export const usualService = {
  c01: 'followup', c02: 'pelvic', c03: 'needling', c04: 'massage', c05: 'reformer', c06: 'followup',
  c07: 'reformer', c08: 'shockwave', c09: 'pelvic', c10: 'followup', c11: 'lymph', c12: 'followup',
  c13: 'reformer', c14: 'needling', c15: 'followup', c16: 'massage', c17: 'followup', c18: 'followup',
  c19: 'reformer', c20: 'pelvic', c21: 'shockwave', c22: 'massage', c23: 'needling', c24: 'reformer',
  c25: 'followup', c26: 'pelvic', c27: 'massage', c28: 'followup', c29: 'followup', c30: 'reformer',
  c31: 'followup', c32: 'massage', c33: 'needling', c34: 'followup', c35: 'reformer', c36: 'massage',
  c37: 'followup', c38: 'shockwave', c39: 'massage', c40: 'reformer', c41: 'followup', c42: 'shockwave', c43: 'followup', c44: 'massage', c45: 'reformer', c46: 'needling', c47: 'pelvic', c48: 'assess', c49: 'massage', c50: 'reformer', c51: 'followup', c52: 'followup', c53: 'followup', c54: 'lymph', c55: 'reformer', c56: 'assess', c57: 'followup', c58: 'needling', c59: 'reformer', c60: 'massage',
};

export const windows = {
  morning: [8 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 20 * 60],
  any: [0, 24 * 60],
};
