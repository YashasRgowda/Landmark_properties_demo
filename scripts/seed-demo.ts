/**
 * Twenty realistic leads across every state — for a demo, and for seeing the
 * screens full.
 *
 *   npm run seed                 # (re)create them
 *   npm run seed -- --remove     # take them all out again
 *
 * SAFE ON THE LIVE DATABASE:
 *  - every lead is on a reserved test number (+91 90000 090xx), which the live
 *    system never messages and never follows up
 *  - no jobs are queued, so nothing is ever sent to them
 *  - running it again replaces the previous set rather than adding to it
 * Follow-ups and calls shown on them are for display; nothing will run them.
 */
import postgres from 'postgres';

const PREFIX = '9190000090';
const SEED_AGENTS = [
  { name: 'Anitha', email: 'seed-anitha@landmark.test', languages: ['kannada', 'english'], phone: '919845011111' },
  { name: 'Srinivas', email: 'seed-srinivas@landmark.test', languages: ['telugu', 'hindi', 'english'], phone: '919845022222' },
];

const H = 3_600_000;
type Msg = [dir: 'in' | 'out', text: string, hoursAgo: number];
type Seed = {
  name: string; source: string; language: string; status: string; category: string | null; score: number;
  budget?: string; timeline?: string; purpose?: string; plot?: string; summary?: string;
  hoursAgo: number; wa: string | null; owner?: 0 | 1; optedOut?: boolean;
  chat?: Msg[];
  visit?: { hoursFromNow: number; status: string; label: string };
  call?: { reason: string; top?: boolean; dueMinutes: number; note: string };
  calls?: [outcome: string, hoursAgo: number][];
  chase?: { state: string; step: number; nextInHours: number };
};

const LEADS: Seed[] = [
  { name: 'Priya Sharma', source: '99acres', language: 'english', status: 'WITH_AGENT', category: 'HOT', score: 13,
    budget: '55 lakh', timeline: '0-3 months', purpose: 'own_construction', plot: '30x50', owner: 0, hoursAgo: 30, wa: 'REPLIED',
    summary: 'Wants a 30x50 East-facing plot to build a home; budget 55 lakh; asked for E-Khata and RERA.',
    chat: [['out', '[template: hello_world]', 30], ['in', 'Hi, is the 30x50 plot still available? East facing?', 29],
      ['out', 'Yes — 9 plots of 30x50 are available, East facing, at ₹52.5 lakh. DC conversion, E-Khata and RERA are all done.', 29],
      ['in', 'My budget is around 55 lakh. Can you send the E-Khata and RERA?', 28],
      ['out', 'Of course. The E-Khata and RERA certificates are attached. Would you like to visit this weekend?', 28]],
    call: { reason: 'HOT_LEAD', top: true, dueMinutes: -20, note: 'Wants 30x50, budget 55 lakh, asked for papers' } },
  { name: 'Arjun Reddy', source: 'magicbricks', language: 'telugu', status: 'VISIT_BOOKED', category: 'HOT', score: 12,
    budget: '50 lakh', timeline: '0-3 months', purpose: 'own_construction', plot: '30x40', owner: 1, hoursAgo: 50, wa: 'REPLIED',
    summary: 'Telugu-speaking; wants a 30x40; visit booked for tomorrow 11 AM.',
    chat: [['out', '[template: hello_world]', 50], ['in', 'ధర ఎంత? 30x40 ఉందా?', 49],
      ['out', 'అవును, 30x40 ప్లాట్లు ₹42 lakh. ఈ వారాంతం సైట్ చూడటానికి రావాలనుకుంటున్నారా?', 49],
      ['in', 'రేపు ఉదయం 11 గంటలకు వస్తాను', 3], ['out', 'సరే, రేపు ఉదయం 11 గంటలకు మిమ్మల్ని కలుస్తాము.', 3]],
    visit: { hoursFromNow: 20, status: 'BOOKED', label: 'రేపు 11 AM' } },
  { name: 'Lakshmi Narayan', source: 'housing', language: 'kannada', status: 'QUALIFIED', category: 'WARM', score: 7,
    budget: '42 lakh', timeline: '3-6 months', purpose: 'investment', plot: '30x40', hoursAgo: 120, wa: 'REPLIED',
    summary: 'Investor, Kannada; 42 lakh budget; went quiet two days ago after asking about resale.',
    chat: [['out', '[template: hello_world]', 120], ['in', 'ಬೆಲೆ ಎಷ್ಟು? ಹೂಡಿಕೆಗೆ ಒಳ್ಳೆಯದಾ?', 119],
      ['out', '30x40 ಸೈಟ್ ₹42 lakh. DC conversion, E-Khata ಮತ್ತು RERA ಆಗಿದೆ.', 119], ['in', 'ಸರಿ, ಯೋಚಿಸುತ್ತೇನೆ', 60]],
    chase: { state: 'WA_GHOST', step: 1, nextInHours: 30 } },
  { name: 'Mohammed Irfan', source: 'website', language: 'english', status: 'CHATTING', category: 'WARM', score: 5,
    budget: '45 lakh', purpose: 'own_construction', hoursAgo: 2, wa: 'REPLIED',
    chat: [['out', '[template: hello_world]', 2], ['in', 'Hello, what approvals does the layout have?', 1.8],
      ['out', 'DC conversion, E-Khata for every plot, and RERA registration are all done. Shall I send them?', 1.8],
      ['in', 'Yes please, and the price list', 1.5]] },
  { name: 'Deepa Iyer', source: 'facebook', language: 'tamil', status: 'READ_NO_REPLY', category: null, score: 0,
    hoursAgo: 4, wa: 'READ', chat: [['out', '[template: hello_world]', 4]],
    call: { reason: 'READ_NO_REPLY', dueMinutes: -30, note: 'Read the first message, did not reply' } },
  { name: 'Suresh Gowda', source: '99acres', language: 'kannada', status: 'DELIVERED_UNREAD', category: null, score: 0,
    hoursAgo: 0.3, wa: 'DELIVERED', chat: [['out', '[template: hello_world]', 0.3]],
    call: { reason: 'DELIVERED_UNREAD', dueMinutes: 5, note: 'Has not opened the first message' } },
  { name: 'Anil Kumar', source: 'magicbricks', language: 'english', status: 'NOT_ON_WHATSAPP', category: null, score: 0,
    hoursAgo: 1, wa: 'NOT_ON_WHATSAPP',
    call: { reason: 'PHONE_ONLY', top: true, dueMinutes: -40, note: 'Not on WhatsApp — the phone is the only way' } },
  { name: 'Kavya Rao', source: '99acres', language: 'english', status: 'NEW', category: null, score: 0, hoursAgo: 0.05, wa: null },
  { name: 'Rahul Verma', source: 'website', language: 'hindi', status: 'MESSAGE_SENT', category: null, score: 0,
    hoursAgo: 0.1, wa: null, chat: [['out', '[template: hello_world]', 0.1]] },
  { name: 'Sneha Patil', source: 'housing', language: 'english', status: 'VISITED', category: 'HOT', score: 14,
    budget: '90 lakh', timeline: '0-3 months', purpose: 'own_construction', plot: '40x60', owner: 0, hoursAgo: 200, wa: 'REPLIED',
    summary: 'Visited two days ago with family; liked the 40x60 North-facing plots; comparing with one other project.',
    chat: [['out', '[template: hello_world]', 200], ['in', 'Do you have 40x60 North facing?', 199],
      ['out', 'Yes, 6 plots of 40x60, North and West facing, at ₹84 lakh.', 199], ['in', 'We visited today, very nice layout', 46]],
    visit: { hoursFromNow: -48, status: 'ATTENDED', label: 'Sunday 11 AM' } },
  { name: 'Vikram Singh', source: 'website', language: 'hindi', status: 'VISIT_BOOKED', category: 'WARM', score: 8,
    budget: '52 lakh', plot: '30x50', owner: 1, hoursAgo: 26, wa: 'REPLIED',
    chat: [['out', '[template: hello_world]', 26], ['in', 'साइट विजिट कब कर सकते हैं?', 25],
      ['out', 'साइट रोज़ सुबह 10 से शाम 6 बजे तक खुली है। आज शाम 4 बजे ठीक रहेगा?', 25], ['in', 'हाँ, आज 4 बजे', 5]],
    visit: { hoursFromNow: 3, status: 'BOOKED', label: 'आज 4 बजे' } },
  { name: 'Meena Krishnan', source: 'facebook', language: 'english', status: 'QUALIFIED', category: 'WARM', score: 8,
    budget: '45 lakh', plot: '30x40', hoursAgo: 96, wa: 'REPLIED',
    summary: 'Booked a visit for yesterday and did not come.',
    chat: [['out', '[template: hello_world]', 96], ['in', 'I will come Saturday 11 AM', 72]],
    visit: { hoursFromNow: -26, status: 'NO_SHOW', label: 'Saturday 11 AM' },
    chase: { state: 'NO_SHOW', step: 1, nextInHours: 18 } },
  { name: 'Ganesh Murthy', source: '99acres', language: 'kannada', status: 'WON', category: 'HOT', score: 16,
    budget: '45 lakh', plot: '30x40', owner: 0, hoursAgo: 500, wa: 'REPLIED',
    summary: 'Booked plot A7 (30x40, East). Registration next week.',
    visit: { hoursFromNow: -400, status: 'ATTENDED', label: 'Sunday 10 AM' } },
  { name: 'Farhan Ali', source: 'magicbricks', language: 'english', status: 'LOST', category: 'COLD', score: 2,
    hoursAgo: 300, wa: 'REPLIED', calls: [['NOT_INTERESTED', 100]],
    chat: [['out', '[template: hello_world]', 300], ['in', 'Too far from the city for me, sorry', 150]] },
  { name: 'Rajesh (broker)', source: 'website', language: 'english', status: 'REJECTED', category: 'REJECT', score: 0,
    hoursAgo: 90, wa: 'REPLIED', summary: 'A broker asking for commission terms, not a buyer.',
    chat: [['out', '[template: hello_world]', 90], ['in', 'I am a broker, what commission do you give?', 89]] },
  { name: 'Pooja Hegde', source: 'housing', language: 'kannada', status: 'WITH_AGENT', category: 'HOT', score: 12,
    budget: '85 lakh', timeline: '0-3 months', plot: '40x60', owner: 0, hoursAgo: 150, wa: 'REPLIED',
    summary: 'Ready to book a 40x60, asked about the booking amount; quiet since yesterday.',
    chat: [['out', '[template: hello_world]', 150], ['in', 'What is the booking amount for 40x60?', 30],
      ['out', 'The booking amount is ₹2 lakh, adjustable and refundable within 15 days.', 30]],
    call: { reason: 'LATE_STAGE', top: true, dueMinutes: -60, note: 'Was close to buying and has gone quiet — ring today' },
    chase: { state: 'LATE_STAGE', step: 1, nextInHours: 70 } },
  { name: 'Karthik S', source: '99acres', language: 'telugu', status: 'QUALIFIED', category: 'WARM', score: 6,
    budget: '52 lakh', plot: '30x50', purpose: 'own_construction', hoursAgo: 20, wa: 'REPLIED',
    summary: 'Asked whether SBI gives a loan on this project.',
    chat: [['out', '[template: hello_world]', 20], ['in', 'Loan vastunda SBI lo?', 18],
      ['out', 'Yes — SBI, HDFC Bank, LIC Housing Finance and Canara Bank all give loans on Ashraya.', 18]] },
  { name: 'Nandini B', source: 'facebook', language: 'english', status: 'CHATTING', category: 'COLD', score: 2,
    timeline: '6+ months', purpose: 'investment', hoursAgo: 6, wa: 'REPLIED',
    chat: [['out', '[template: hello_world]', 6], ['in', 'Just looking for now, maybe next year', 5]] },
  { name: 'Ashok Kumar', source: 'magicbricks', language: 'english', status: 'NEW', category: null, score: 0, hoursAgo: 0.02, wa: null },
  { name: 'Divya Menon', source: 'website', language: 'english', status: 'VISIT_BOOKED', category: 'HOT', score: 11,
    budget: '60 lakh', timeline: '0-3 months', plot: '30x50', owner: 1, hoursAgo: 40, wa: 'REPLIED',
    chat: [['out', '[template: hello_world]', 40], ['in', 'Can I come next Sunday with my parents?', 30],
      ['out', 'Of course — next Sunday at 11 AM, with free pickup from Yelahanka.', 30]],
    visit: { hoursFromNow: 24 * 6, status: 'BOOKED', label: 'next Sunday 11 AM' } },
];

/**
 * A visit "n hours from now" lands on that day at a real visiting hour — 11 AM
 * or 4 PM — so a demo run at midnight does not show a visit at 2:54 AM. Visits
 * in the past keep their day; a visit "today" that would already have passed
 * is moved to this evening.
 */
function realisticVisitTime(now: number, hoursFromNow: number): Date {
  const IST = 330 * 60_000;
  const local = new Date(now + hoursFromNow * H + IST);
  const at = (h: number) => new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, 0) - IST);
  const morning = at(11);
  const evening = at(16);
  if (hoursFromNow < 0) return local.getUTCHours() < 14 ? morning : evening;
  if (morning.getTime() > now) return morning;
  if (evening.getTime() > now) return evening;
  return new Date(morning.getTime() + 24 * H); // nothing left today: tomorrow morning
}

async function main() {
  const remove = process.argv.includes('--remove');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

  try {
    const gone = await sql`delete from leads where phone like ${PREFIX + '%'} returning id`;
    await sql`delete from agents where email like 'seed-%@landmark.test'`;
    if (remove) {
      console.log(`Removed ${gone.length} demo lead(s) and the demo agents.`);
      return;
    }

    const now = Date.now();
    const at = (hoursAgo: number) => new Date(now - hoursAgo * H);

    const agentIds: string[] = [];
    for (const a of SEED_AGENTS) {
      const [row] = await sql`insert into agents (name, email, phone, languages, active)
        values (${a.name}, ${a.email}, ${a.phone}, ${a.languages}, true) returning id`;
      agentIds.push(row.id);
    }

    for (const [i, s] of LEADS.entries()) {
      const phone = `${PREFIX}${String(i + 1).padStart(2, '0')}`;
      const [lead] = await sql`insert into leads (phone, name, source, project, status, category, score,
          budget, timeline, purpose, language, interested_plot, summary, wa_state, owner_agent_id,
          opted_out, created_at, updated_at, last_contact_at)
        values (${phone}, ${s.name}, ${s.source}, 'Ashraya', ${s.status}, ${s.category}, ${s.score},
          ${s.budget ?? null}, ${s.timeline ?? null}, ${s.purpose ?? null}, ${s.language}, ${s.plot ?? null},
          ${s.summary ?? null}, ${s.wa}, ${s.owner === undefined ? null : agentIds[s.owner]},
          ${s.optedOut ?? false}, ${at(s.hoursAgo)}, ${at(Math.min(...(s.chat ?? []).map((m) => m[2]), s.hoursAgo))},
          ${s.chat?.length ? at(Math.min(...s.chat.map((m) => m[2]))) : null})
        returning id`;

      await sql`insert into touches (lead_id, channel, direction, outcome, notes, happened_at)
        values (${lead.id}, 'portal', 'inbound', 'enquiry', ${`enquiry from ${s.source} for Ashraya`}, ${at(s.hoursAgo)})`;

      for (const [j, [dir, text, ago]] of (s.chat ?? []).entries()) {
        const template = text.startsWith('[template:') ? 'hello_world' : null;
        await sql`insert into messages (lead_id, direction, body, template_name, wa_message_id, status, sent_at)
          values (${lead.id}, ${dir === 'in' ? 'inbound' : 'outbound'}, ${text}, ${template},
            ${`wamid.seed.${phone}.${j}`}, ${dir === 'in' ? 'delivered' : 'read'}, ${at(ago)})`;
        await sql`insert into touches (lead_id, channel, direction, outcome, happened_at)
          values (${lead.id}, 'whatsapp', ${dir === 'in' ? 'inbound' : 'outbound'}, ${dir === 'in' ? 'replied' : 'sent'}, ${at(ago)})`;
      }

      for (const [outcome, ago] of s.calls ?? []) {
        await sql`insert into touches (lead_id, channel, direction, outcome, happened_at)
          values (${lead.id}, 'call', 'outbound', ${outcome}, ${at(ago)})`;
      }

      if (s.visit) {
        const visitAt = realisticVisitTime(now, s.visit.hoursFromNow);
        await sql`insert into visits (lead_id, visit_at, label, status, outcome_at)
          values (${lead.id}, ${visitAt}, ${s.visit.label}, ${s.visit.status},
                  ${s.visit.status === 'BOOKED' ? null : visitAt})`;
      }

      if (s.call) {
        await sql`insert into call_tasks (lead_id, agent_id, reason, priority, due_at, status, notes)
          values (${lead.id}, ${s.owner === undefined ? null : agentIds[s.owner]}, ${s.call.reason},
                  ${s.call.top ? 10 : 0}, ${new Date(now + s.call.dueMinutes * 60_000)}, 'PENDING', ${s.call.note})`;
      }

      if (s.chase) {
        await sql`insert into chase_states (lead_id, state, step, next_step_at, status, created_at)
          values (${lead.id}, ${s.chase.state}, ${s.chase.step}, ${new Date(now + s.chase.nextInHours * H)},
                  'ACTIVE', ${at(24)})`;
      }
    }

    const statuses = new Set(LEADS.map((l) => l.status));
    console.log(`Created ${LEADS.length} demo leads (+91 90000 09001–${String(LEADS.length).padStart(2, '0')}) covering ${statuses.size} statuses,`);
    console.log(`and ${SEED_AGENTS.length} demo agents (${SEED_AGENTS.map((a) => a.name).join(', ')}).`);
    console.log('They are on reserved test numbers: the live system never messages or follows them up.');
    console.log('Remove them with:  npm run seed -- --remove');
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
