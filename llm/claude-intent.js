// Optional: use Claude to understand requests instead of the offline parser.
//
//   npm install @anthropic-ai/sdk
//   export ANTHROPIC_API_KEY=...        (or `ant auth login`)
//   node llm/claude-intent.js "Jona has a family emergency, she's out this afternoon"
//
// Claude only fills in the intent JSON (src/intent-schema.js). It never sees the booking
// tools: slots are found and checked by src/, and a person confirms every change.

import Anthropic from '@anthropic-ai/sdk';
import { INTENT_SCHEMA, sanitizeIntent } from '../src/intent-schema.js';
import { makeCatalog } from '../src/seed.js';
import { localToday, DAY_NAMES, weekday } from '../src/time.js';

const client = new Anthropic();

function systemPrompt(catalog) {
  const list = (rows, f) => rows.map(f).join('\n');
  return `You turn a receptionist's message at ${catalog.studio.name} into one JSON intent.
Messages can be in English, Albanian or Italian, and are often short or informal.

Pick ids only from these lists. If a name matches more than one client, leave client_id null and list every match in client_candidates. If you can't tell, leave a field null and name it in "missing"; the app will ask the receptionist.

Staff:
${list(catalog.staff, (s) => `${s.id}: ${s.name} (${s.role})`)}

Services:
${list(catalog.services, (s) => `${s.id}: ${s.name}, ${s.minutes} min`)}

Clients:
${list(catalog.clients.filter((c) => !c.virtual), (c) => `${c.id}: ${c.name}`)}

Rules for dates: "next Tuesday" means Tuesday of next week (weeks start Monday). A bare hour from 1 to 7 means pm. For "move", put the new time in "target"; for "push back an hour" use shift_minutes. For staff absences fill "absence" with start/end in minutes after midnight (whole day = 0 to 1440).`;
}

export async function claudeIntent(text, { today = localToday(), catalog = makeCatalog() } = {}) {
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: INTENT_SCHEMA } },
    system: [{ type: 'text', text: systemPrompt(catalog), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Today is ${DAY_NAMES[weekday(today)]} ${today}.\n\nMessage: ${text}` }],
  });
  if (response.stop_reason === 'refusal') return { intent: null, missing: ['intent'], confidence: 0 };
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error(`No JSON in response (stop_reason: ${response.stop_reason})`);
  return sanitizeIntent(JSON.parse(block.text), catalog);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(await claudeIntent(process.argv.slice(2).join(' ') || 'Arben called in sick today'), null, 2));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error('Set ANTHROPIC_API_KEY or run `ant auth login` first.');
    else if (error instanceof Anthropic.RateLimitError) console.error('Rate limited, try again shortly.');
    else if (error instanceof Anthropic.APIError) console.error(`API error ${error.status}: ${error.message}`);
    else throw error;
    process.exitCode = 1;
  }
}
