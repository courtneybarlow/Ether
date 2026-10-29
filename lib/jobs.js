// Ether's scheduled jobs (morning refresh, nudges, Sunday reset). Run from /api/tick every 15 minutes;
// each job runs once per day inside its time window, in Courtney's local time (handles daylight saving).
import { getDoc, setDoc, listCol, vaultGet, vaultSet, localParts, addDays, hm, env } from './core.js';
import { claude, textOf, researchJSON, parseJSON } from './claude.js';
import { weather } from './weather.js';
import { postingSoon } from './planable.js';
import { allEventsBetween } from './calendar.js';
import { pickNine, cmpFor, eligible, isWeekend } from './nine.js';
import { notify } from './push.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const at = (h, m) => h * 60 + m;

export const JOBS = {
  morningRefresh: { at: at(5, 40), window: 6 * 60, days: [0, 1, 2, 3, 4, 5, 6], run: morningRefresh },
  morningNudge: { at: at(6, 42), window: 3 * 60, days: [0, 1, 2, 3, 4, 5, 6], run: morningNudge },
  middayCheck: { at: at(12, 13), window: 90, days: [1, 2, 3, 4, 5], run: middayCheck },
  sundayReset: { at: at(17, 43), window: 4 * 60, days: [0], run: sundayReset },
  closeDayNudge: { at: at(20, 30), window: 90, days: [0, 1, 2, 3, 4, 5, 6], run: closeDayNudge }
};

export async function tick(owner, { force } = {}) {
  const now = localParts();
  const log = (await vaultGet(owner, 'jobs')) || {};
  const ran = [];
  const names = force ? [force] : Object.keys(JOBS);
  for (const name of names) {
    const j = JOBS[name]; if (!j) continue;
    if (!force) {
      if (!j.days.includes(now.dow)) continue;
      if (now.mins < j.at || now.mins > j.at + j.window) continue;
      if (log[name] === now.date) continue;
    }
    try {
      const result = await j.run(owner, now);
      log[name] = now.date; await vaultSet(owner, 'jobs', log);
      ran.push({ name, ok: true, result });
    } catch (e) {
      console.error('job', name, e);
      ran.push({ name, ok: false, error: e.message });
    }
    if (!force) break; // one job per tick keeps each run well inside the time limit
  }
  return { now, ran };
}

/* ---------- 5:40 am: weather, affirmation, markets, posting, shows ---------- */
async function morningRefresh(owner, now) {
  const today = now.date;
  const prev = (await getDoc(owner, 'brief/today')) || {};
  const prefsAff = (await getDoc(owner, 'prefs/affirmation')) || {};
  const prefsMedia = (await getDoc(owner, 'prefs/media')) || {};
  const brief = { date: today, affirmation: prev.affirmation || '', weather: null, media: [], markets: null, content: [], updatedAt: new Date().toISOString() };
  const problems = [];

  try { brief.weather = await weather(); } catch (e) { problems.push('weather'); }

  try {
    const r = await claude({
      system: 'Reply with only the affirmation text.',
      messages: [{ role: 'user', content: `Write one new, short (under 20 words), grounded, first-person affirmation for Courtney, a busy founder balancing a 9-to-5, her agency November Social and her wellness brand Seven Wellness Club. ${prefsAff.style ? 'Style: ' + prefsAff.style + '.' : 'Calm, confident, not cheesy.'} Don't repeat yesterday's: "${prev.affirmation || ''}".` }],
      max_tokens: 120
    });
    brief.affirmation = textOf(r).replace(/^["“]|["”]$/g, '').trim() || brief.affirmation;
  } catch (e) { problems.push('affirmation'); }

  try {
    const posts = await postingSoon();
    if (posts) brief.content = posts.map(p => { const lp = p.at ? localParts(new Date(p.at)) : { date: today }; return { ...p, time: lp.date === today ? p.time : (WD[lp.dow] + ' ' + p.time) }; });
  } catch (e) { problems.push('Planable'); }

  if (Array.isArray(prefsMedia.shows) && prefsMedia.shows.length) {
    try {
      const j = await researchJSON(`Find the newest episode of each of these shows/podcasts: ${prefsMedia.shows.slice(0, 5).join(', ')}. Reply with JSON {"media":[{"title":"episode title","show":"show name","length":"e.g. 48 min or empty","url":"https link to the episode on YouTube, Spotify or Apple Podcasts"}]} with at most 3 entries, newest first. Only include episodes you actually found.`, { maxUses: 5, max_tokens: 1200, location: false });
      brief.media = (j.media || []).filter(m => m && m.title && /^https:\/\//.test(m.url || '')).slice(0, 3);
    } catch (e) { problems.push('shows'); }
  }

  try {
    const j = await researchJSON(`Today is ${today}. Write a short, upbeat morning money brief in the spirit of a daily markets newsletter, for Courtney (a founder in Nashville). Research what happened in US markets and the economy over the last trading day and what is ahead today: how the S&P 500, Nasdaq and Dow closed; the biggest economic or Fed news; one notable company or consumer/retail story; today's economic calendar. Prefer Reuters, AP, CNBC, Bloomberg, WSJ, MarketWatch, Yahoo Finance and government data. Only include facts you actually found from the last 1-2 days; never fill in numbers from memory. Write in your own words. No investment advice.
Reply with JSON: {"headline":"punchy line under 12 words","items":[{"title":"2-5 words","body":"one or two plain-English sentences on what happened and why it matters to an everyday person or small business owner"}],"sources":[{"title":"outlet","url":"https://..."}]} with 3-4 items and up to 5 sources. If you can't find solid current information reply {"markets":null}.`, { maxUses: 6, max_tokens: 2000, location: false });
    brief.markets = j && j.items ? { headline: j.headline, items: j.items.slice(0, 4), sources: (j.sources || []).slice(0, 5) } : null;
  } catch (e) { problems.push('markets'); }

  await setDoc(owner, 'brief/today', brief);
  return { problems };
}

/* ---------- helpers for nudges ---------- */
async function dayState(owner, today) {
  const items = await listCol(owner, 'items');
  const order = (await getDoc(owner, 'nineorder/' + today)) || {};
  const nine = pickNine(items, today, Array.isArray(order.ids) ? order.ids : []);
  return { items, nine };
}
async function eventsToday(today) {
  const from = new Date(Date.now() - 18 * 3600e3), to = new Date(Date.now() + 30 * 3600e3);
  return (await allEventsBetween(from, to))
    .filter(e => e.status !== 'cancelled' && e.start.dateTime)
    .map(e => ({ ...e, s: new Date(e.start.dateTime), e: new Date(e.end.dateTime || e.start.dateTime) }))
    .filter(e => localParts(e.s).date === today && (e.e - e.s) < 12 * 3600e3)
    .sort((a, b) => a.s - b.s);
}
const list = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];

/* ---------- 6:42 am: good-morning push ---------- */
async function morningNudge(owner, now) {
  const today = now.date;
  const { items } = await dayState(owner, today);
  const brief = (await getDoc(owner, 'brief/today')) || {};
  let first = null; try { first = (await eventsToday(today))[0]; } catch (e) {}
  const open = items.filter(it => !it.done && eligible(it, today));
  const cmp = cmpFor(today);
  const pinnedFirst = (a, b) => ((b.pinnedFor === today || (b.alwaysMust && b.due === today)) - (a.pinnedFor === today || (a.alwaysMust && a.due === today))) || cmp(a, b);
  const parts = ['Good morning, Courtney.'];
  const w = brief.date === today && brief.weather;
  if (w) parts.push(`${w.now}, ${String(w.summary || '').replace(/^·\s*/, '').toLowerCase()}.`);
  parts.push(first ? `First up: ${first.summary} at ${hm(first.s)}.` : 'Your calendar is clear.');
  if (isWeekend(today)) {
    const top = open.filter(it => it.area !== 'work').sort(pinnedFirst).slice(0, 3).map(x => x.title);
    if (top.length) parts.push(`Today: ${list(top)}.`);
  } else {
    const work = open.filter(it => it.area === 'work').sort(cmp).slice(0, 2).map(x => x.title);
    const also = open.filter(it => it.area !== 'work').sort(pinnedFirst).slice(0, 2).map(x => x.title);
    if (work.length) parts.push(`9-to-5: ${list(work)}.`);
    if (also.length) parts.push(`Also: ${list(also)}.`);
  }
  const late = open.filter(it => it.due && it.due < today && !(isWeekend(today) && it.area === 'work')).length;
  if (late) parts.push(`${late} overdue.`);
  return notify(owner, { title: 'Good morning ☀️', body: parts.slice(1).join(' '), tag: 'morning' });
}

/* ---------- 12:13 pm weekdays: only if must-dos are still open ---------- */
async function middayCheck(owner, now) {
  const { nine } = await dayState(owner, now.date);
  const open = nine.must.filter(x => !x.done);
  if (!open.length) return { skipped: 'all must-dos done' };
  const top = open[0];
  const body = open.length === 1 ? `One must-do left: ${top.title}. A 25-minute focus block after lunch would close it out.`
    : `${open.length} must-dos still open: ${list(open.map(x => x.title))}. Start with ${top.title}; even 25 minutes moves it.`;
  return notify(owner, { title: 'Midday check-in', body, tag: 'midday' });
}

/* ---------- 8:30 pm: close the day, only if not closed ---------- */
async function closeDayNudge(owner, now) {
  const log = await getDoc(owner, 'daylog/' + now.date);
  if (log && log.closedAt) return { skipped: 'already closed' };
  return notify(owner, { title: 'Close out the day?', body: 'Two minutes: check off what got done and pick tomorrow’s three.', tag: 'close', url: '/?open=close' });
}

/* ---------- Sunday 5:43 pm: weekly recap + plan ---------- */
async function sundayReset(owner, now) {
  const today = now.date, since = addDays(today, -6), weekStart = addDays(today, 1);
  const items = await listCol(owner, 'items');
  const sessions = (await listCol(owner, 'sessions')).filter(s => s.date >= since);
  const logs = (await listCol(owner, 'log')).filter(l => l.kind === 'work' && String(l.at || '').slice(0, 10) >= since);
  const done = items.filter(it => it.done && it.doneAt && localParts(new Date(it.doneAt)).date >= since);
  const open = items.filter(it => !it.done && !it.someday && it.due && it.due <= addDays(today, 14)).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 40);
  const byArea = {}; done.forEach(it => { byArea[it.area] = (byArea[it.area] || 0) + 1; });
  const focusH = (sessions.reduce((s, x) => s + (x.mins || 0), 0) / 60).toFixed(1);
  const loads = logs.map(l => l.load).filter(Boolean);
  const res = await claude({
    system: 'Reply with ONLY JSON.',
    messages: [{ role: 'user', content: `Write Courtney's "Sunday reset" for the week of ${weekStart}. Areas: work = her 9-to-5 (top priority on weekdays), nov = November Social (her agency), swc = Seven Wellness Club (her wellness brand), life, home.
Last 7 days: finished per area ${JSON.stringify(byArea)}; focus hours tracked ${focusH}; work load scores ${JSON.stringify(loads)}.
Finished: ${done.slice(0, 40).map(it => `[${it.area}] ${it.title}`).join('; ') || 'none logged'}
Open with due dates in the next 2 weeks: ${open.map(it => `[${it.area}] ${it.title} (due ${it.due}${it.priority === 'p0' ? ', top priority' : ''})`).join('; ') || 'none'}
Reply {"recap":"2-3 warm, specific sentences: what got done, focus time, one honest pattern worth noticing, no guilt","plan":["5-7 short lines for the coming week from real open items: biggest deadlines, what to protect time for, one gentle wellness intention"],"headline":"the single most important thing this week, under 15 words"}` }],
    max_tokens: 900
  });
  const j = parseJSON(textOf(res));
  await setDoc(owner, 'weekly/latest', { weekOf: weekStart, recap: j.recap, plan: (j.plan || []).slice(0, 7), createdAt: new Date().toISOString() });
  return notify(owner, { title: 'Your Sunday reset is ready', body: j.headline || 'Open Ether for your week ahead.', tag: 'sunday', url: '/?open=analytics' });
}
