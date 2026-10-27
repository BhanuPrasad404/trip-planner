// The instant reader: no AI, no network, a few milliseconds. Reads what a traveller wrote — in English, Telugu, Hindi, Tamil, Kannada or
// Marathi, romanized or in its own script — into answers, each with the words it came from. It is deliberately cautious: a field is
// filled only when the words for it are really there. Place NAMES are only collected here as candidates; lib/intake/places.ts decides
// which are real places (and the AI, when it answers, adds the ones this reader cannot separate from the rest of a sentence).
import {
  DAY_UNITS, DRIVE_WORDS, ENGLISH_MAY, FROM_AFTER, GENERIC_TAGS, GROUP_WORDS, HOUR_UNITS, INTEREST_WORDS, MODE_WORDS, MONTH_WORDS, MUST, NEGATION, NEXT_MONTH,
  NIGHT_UNITS, NIGHT_WORDS, NUMBER, ONE_WAY, PACKED, PEOPLE_UNITS, RELAXED, ROUND_TRIP, THIS_MONTH, WEEK, WEEKEND, asciiDigits, numberWord, wholeShortWords, words,
} from "./lexicon";
import type { AnswerKey, Group, Interest, Known, SaidPlace, TravelMode, TripAnswers } from "./types";

export type InstantReading = {
  answers: { [K in AnswerKey]?: Known<NonNullable<TripAnswers[K]>> };
  /** Where the trip starts, longest guess first ("New Delhi", "Delhi"). Resolved to a real place by lib/intake/places.ts. */
  startCandidates: string[];
  /** Possible place names, as written. Most are not places; only exact matches survive lib/intake/places.ts. */
  places: SaidPlace[];
  scripts: string[];
};

const alt = (list: string[]) => [...list].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const DAYS_RE = new RegExp(`(?<![\\p{L}\\p{N}])${NUMBER}\\s*-?\\s*(?:${alt(DAY_UNITS)})`, "iu");
const NIGHTS_RE = new RegExp(`(?<![\\p{L}\\p{N}])${NUMBER}\\s*-?\\s*(?:${alt(NIGHT_UNITS)})(?![\\p{L}])`, "iu");
const ND_RE = /(?<![\p{L}\p{N}])(\d{1,2})\s*n\s*[/&,-]?\s*(\d{1,2})\s*d(?![\p{L}])/iu; // "3N/4D"
const PEOPLE_RE = new RegExp(`(?<![\\p{L}\\p{N}])${NUMBER}\\s*(?:${alt(PEOPLE_UNITS)})`, "iu");
const WE_ARE_RE = /\bwe\s+are\s+(\d{1,2})\b/i;
const HOURS_RE = new RegExp(`(?<![\\p{L}\\p{N}])${NUMBER}\\s*(?:${alt(HOUR_UNITS)})(?![\\p{L}])`, "giu");
const MONTH_RES = MONTH_WORDS.map((list) => wholeShortWords(list));
const SCRIPTS: [string, RegExp][] = [["Telugu", /[ఀ-౿]/], ["Devanagari", /[ऀ-ॿ]/], ["Tamil", /[஀-௿]/], ["Kannada", /[ಀ-೿]/], ["Latin", /[A-Za-z]/]];

const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : numberWord(s));
const first = (re: RegExp, text: string) => { re.lastIndex = 0; const m = re.exec(text); return m ? { at: m.index, text: m[0] } : null; };
const said = <T,>(value: T, evidence: string): Known<T> => ({ value, source: "said", evidence: evidence.trim().slice(0, 80) });

/** Words that carry no place: grammar words and trip words in each language (romanized). Used to clean place-name candidates. */
const FILLER = new Set(["ట్రిప్", "ट्रिप", "ட்ரிப்", "ಟ್ರಿಪ್", "ಪ್ರವಾಸ", "प्रवास", "यात्रा", "యాత్ర", "பயணம்", "टूर",
  "और", "के", "की", "का", "को", "से", "में", "पर", "है", "हैं", "साथ", "आहेत", "आणि", "तो", "తో", "లో", "ఉన్నారు", "మరియు", "உடன்", "மற்றும்", "ಜೊತೆ", "ಮತ್ತು", "the", "a", "an", "and", "or", "with", "for", "to", "of", "in", "on", "at", "by", "is", "are", "was", "we", "our", "us", "my", "i", "me", "trip", "tour", "plan", "planning", "visit", "visiting", "go", "going", "want", "wanna", "also", "then", "next", "this", "that", "some", "few", "near", "around", "via", "lo", "tho", "ki", "ka", "ke", "ko", "ni", "nu", "mein", "me", "se", "aur", "hai", "hain", "undi", "unnaru", "cheyyali", "cheddam", "velladam", "veldam", "karna", "karenge", "jaana", "jana", "jayenge", "chalo", "lets", "let's", "manam", "memu", "hum", "ham", "naan", "naanga", "naavu", "aamhi", "pls", "please", "must", "is", "a", "ga", "kuda", "bhi", "and", "mariyu", "mattu", "aani", "ani", "um", "ah", "trip", "pakka", "definitely", "it", "its", "it's", "day", "days", "places", "place", "spots", "spot"]);

/** Action and position words that open a sentence about a place ("See Hampi", "Visit Araku", "Near Gandikota"): never part of the name. */
const LEADING_ACTION = /^(?:see|visit|visiting|explore|exploring|reach|reaching|cover|covering|include|including|add|adding|try|check|enjoy|go|going|goto|via|near|nearby|around|towards?|trip|tour)$/i;

export function readTrip(input: string, opts: { todayMonth: number }): InstantReading {
  const raw = asciiDigits(input.normalize("NFC")).slice(0, 4000);
  const tags = [...raw.matchAll(/#([\p{L}\p{N}_]{3,40})/gu)].map((m) => m[1]);
  // Hashtags never count as words for answers ("#weekendvibes" is not "a weekend trip").
  const text = raw.replace(/#[\p{L}\p{N}_]+/gu, " ");
  const answers: InstantReading["answers"] = {};

  // Days — "4 days", "4 rojulu", "चार दिन", "3N/4D", "3 nights", "weekend", "a week".
  const nd = ND_RE.exec(text);
  const d = DAYS_RE.exec(text);
  const n = NIGHTS_RE.exec(text);
  if (nd) answers.days = said(Number(nd[2]), nd[0]);
  else if (d && num(d[1])) answers.days = said(num(d[1])!, d[0]);
  else if (n && num(n[1])) answers.days = said(num(n[1])! + 1, n[0]); // "3 nights" = a 4-day trip, the way Indian packages count
  else { const w = first(words(WEEKEND), text) ?? null; const wk = first(words(WEEK), text); if (wk) answers.days = said(7, wk.text); else if (w) answers.days = said(2, w.text); }
  if (answers.days && (answers.days.value < 1 || answers.days.value > 30)) delete answers.days;

  // Month — a month name, "next month" / "this month" (from today's month in India).
  const months = MONTH_RES.map((re, i) => ({ i, m: first(re, text) })).filter((x) => x.m);
  const may = ENGLISH_MAY.exec(text);
  if (may) months.push({ i: 4, m: { at: may.index, text: may[0] } });
  months.sort((a, b) => a.m!.at - b.m!.at);
  const next = first(words(NEXT_MONTH), text), thisM = first(words(THIS_MONTH), text);
  if (months[0]) answers.month = said(months[0].i + 1, months[0].m!.text);
  else if (next) answers.month = said((opts.todayMonth % 12) + 1, next.text);
  else if (thisM) answers.month = said(opts.todayMonth, thisM.text);

  // Who is going — kids and elders win over plain "family".
  for (const [g, list] of GROUP_WORDS) { const m = first(words(list), text); if (m) { answers.group = said<Group>(g, m.text); break; } }
  const ppl = PEOPLE_RE.exec(text) ?? WE_ARE_RE.exec(text);
  if (ppl && num(ppl[1]) && num(ppl[1])! >= 1 && num(ppl[1])! <= 60) answers.groupSize = said(num(ppl[1])!, ppl[0]);

  // How they travel — the first one mentioned.
  const modes = MODE_WORDS.map(([m, list]) => ({ m, hit: first(words(list), text) })).filter((x) => x.hit).sort((a, b) => a.hit!.at - b.hit!.at);
  if (modes[0]) answers.mode = said<TravelMode>(modes[0].m, modes[0].hit!.text);

  // Night driving — a night word with a "no" next to it ("no night driving", "night driving vaddu", "रात में ड्राइव नहीं").
  const nightRe = words(NIGHT_WORDS), negRe = words(NEGATION);
  for (const m of text.matchAll(nightRe)) {
    if (/\d\s*$/.test(text.slice(Math.max(0, m.index - 4), m.index))) continue; // "3 nights" is a length, not a rule
    const around = text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 28);
    if (first(negRe, around)) { answers.nightDriving = said(false, around); break; }
    if (/\b(ok|okay|fine|is fine|no problem|chalega|parledu|paravala)\b/i.test(around)) { answers.nightDriving = said(true, around); break; }
  }

  // Pace and the most driving per day ("5 hours driving", "5 gantalu drive", "max 6 ghante").
  const rel = first(words(RELAXED), text), pk = first(words(PACKED), text);
  if (rel) answers.pace = said("relaxed", rel.text); else if (pk) answers.pace = said("packed", pk.text);
  const driveRe = words(DRIVE_WORDS);
  for (const m of text.matchAll(HOURS_RE)) {
    const around = text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25);
    const h = num(m[1]);
    if (h && h >= 1 && h <= 14 && first(driveRe, around)) { answers.maxDriveHours = said(h, around); break; }
  }

  // Round trip or one way.
  const one = first(words(ONE_WAY), text), round = first(words(ROUND_TRIP), text);
  if (one) answers.endMode = said("place", one.text); else if (round) answers.endMode = said("start", round.text);

  // Interests — all that are mentioned.
  const ints: Interest[] = []; const ev: string[] = [];
  for (const [i, list] of INTEREST_WORDS) { const m = first(words(list), text); if (m) { ints.push(i); ev.push(m.text); } }
  if (ints.length) answers.interests = said(ints, ev.join(", "));

  // Where it starts — "from X" (English) or "X nundi / X se / X से / X నుండి / Xನಿಂದ / X இருந்து".
  const startCandidates = startGuesses(text);
  // "Chennai to Pondicherry": the first is the start; the second is a place (and the end, if they said one way).
  const to = /(?:^|[\s,])([A-Z][\p{L}]+(?:\s[A-Z][\p{L}]+)?)\s+to\s+([A-Z][\p{L}]+(?:\s[A-Z][\p{L}]+)?)/u.exec(text);
  if (to && startCandidates.length === 0) startCandidates.push(to[1]);
  if (to && answers.endMode?.value === "place") answers.endSaid = said(to[2], to[0]);
  if (startCandidates[0]) answers.startSaid = said(startCandidates[0], startCandidates[0]);

  // Possible place names: pieces of the text between commas, lines, pins, "and"… cleaned of the words read above.
  const known = [DAYS_RE, NIGHTS_RE, ND_RE, PEOPLE_RE, ...GROUP_WORDS.map(([, l]) => words(l)), ...MODE_WORDS.map(([, l]) => words(l)), words(NIGHT_WORDS), words(NEGATION), words(RELAXED), words(PACKED),
    words(ONE_WAY), words(ROUND_TRIP), ...MONTH_RES, words(NEXT_MONTH), words(THIS_MONTH), words(WEEKEND), words(DRIVE_WORDS), words(FROM_AFTER), HOURS_RE];
  const startWords = startCandidates.flatMap((s) => s.toLowerCase().split(" ")).filter((w) => w.length >= 2);
  const isStartWord = (w: string) => startWords.some((s) => w.toLowerCase() === s || (!/^[\x20-\x7e]+$/.test(w) && w.startsWith(s)));
  // A place word looks like a name: Capitalised in Latin script, or written in an Indian script. Lower-case Latin words ("meeda", "jothe")
  // are almost always grammar, not places — the AI reader is the one that finds lower-case names.
  const looksLikeName = (w: string) => /^\p{Lu}/u.test(w) || /[ऀ-෿]/u.test(w);
  const places: SaidPlace[] = [];
  const add = (s: string, must: boolean, evidence: string) => {
    const clean = s.replace(/[^\p{L}\p{M}\p{N}\s'.&-]/gu, " ").replace(/\s+/g, " ").trim().replace(/^[.'&-]+|[.'&-]+$/g, "").trim();
    // A piece starting with a vowel sign is the left-over end of a word whose start we removed ("களுடன்" from "நண்பர்களுடன்").
    const kept = clean.split(" ").filter((w) => w && !/^\p{M}/u.test(w) && !FILLER.has(w.toLowerCase()) && !isStartWord(w));
    // "See Hampi", "Visit Lepakshi Temple", "Go to Goa", "Near Araku": the action word at the front is not part of the name. It starts with a
    // capital (it opens the sentence), so the capital-letter rule below can't tell. Only when a name is left after it ("Go" alone stays).
    while (kept.length > 1 && LEADING_ACTION.test(kept[0])) kept.shift();
    // Trim lower-case words from both ends ("Lepakshi temple" keeps "temple" inside the name; "meeda" alone goes).
    while (kept.length && !looksLikeName(kept[0])) kept.shift();
    while (kept.length > 1 && !looksLikeName(kept[kept.length - 1]) && !/^(temple|falls|fort|caves?|beach|lake|dam|hills?|valley|palace|park|waterfalls?|peak|island)$/i.test(kept[kept.length - 1])) kept.pop();
    const name = kept.join(" ").trim();
    if (name.length < 3 || kept.length > 5 || !/\p{L}/u.test(name)) return;
    if (places.some((p) => p.said.toLowerCase() === name.toLowerCase())) return;
    places.push({ said: name, must, source: "said", evidence: evidence.trim().slice(0, 80) });
  };
  const mustRe = words(MUST);
  const pieces = text.split(/\n|📍|•|\||;|,|\/|\+|&|\s[-–—]\s|–|—|(?<!\b(?:St|Mt|Dr))\.\s|\s(?:and|aur|mariyu|mattu|aani|ani|plus|then|tarvata|phir|phir se|apram|aamele|naantar)\s/iu);
  for (const piece of pieces) {
    if (!piece || !piece.trim()) continue;
    const must = !!first(mustRe, piece);
    let s = piece;
    for (const re of [...known, mustRe]) { re.lastIndex = 0; s = s.replace(re, " "); }
    for (const [, list] of INTEREST_WORDS) {
      // Indian-script topic words ("मंदिर", "ಜಲಪಾತ") always go; English ones only when nothing else is left, so "Lepakshi temple" keeps "temple".
      s = s.replace(words(list.filter((w) => !/^[\x20-\x7e]+$/.test(w))), " ");
      const re = words(list.filter((w) => /^[\x20-\x7e]+$/.test(w)));
      const left = s.replace(re, " ");
      if (left.trim().split(/\s+/).filter((w) => w && !FILLER.has(w.toLowerCase())).length === 0) s = left;
    }
    s = s.replace(/\b\d+\b/g, " ");
    add(s, must, piece);
  }
  for (const t of tags) if (!GENERIC_TAGS.test(t)) add(t.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"), false, `#${t}`);

  return { answers, startCandidates, places, scripts: SCRIPTS.filter(([, re]) => re.test(raw)).map(([s]) => s) };
}

/** Kannada and Tamil add "from" to the word itself; strip it to get the place ("ಬೆಂಗಳೂರಿನಿಂದ" → "ಬೆಂಗಳೂರ"). */
// Marathi "पुण्याहून" (from Pune) bends the place name itself, so it is only partly recoverable without AI (said so in the report).
const SUFFIX_FROM = /(?:ಿನಿಂದ|ನಿಂದ|ಿಂದ|ಇಂದ|யிலிருந்து|இலிருந்து|ிலிருந்து|லிருந்து|ाहून|हून)$/u;
const STOP_BEFORE = /^(?:\d+|trip|days?|rojulu|din|tho|ke|ka|ki|saath|with|and|our|we|manam|hum|lo|nunchi)$/i;

function startGuesses(text: string): string[] {
  const out: string[] = [];
  const push = (s: string) => { const t = s.replace(/[^\p{L}\p{M}\s.]/gu, " ").replace(/\s+/g, " ").trim(); if (t.length >= 2 && !out.includes(t)) out.push(t); };
  // English: "from New Delhi", "from hyderabad"
  const en = /\bfrom\s+([\p{L}][\p{L}.]*(?:\s+[\p{L}][\p{L}.]*){0,2})/iu.exec(text);
  if (en) {
    const ws = en[1].split(/\s+/);
    const cut = ws.findIndex((w) => /^(to|with|for|and|on|in|by|trip|tour|via|we|i|our|the|next|this|days?|nights?)$/i.test(w));
    const keep = cut === -1 ? ws : ws.slice(0, cut);
    for (let k = keep.length; k >= 1; k--) push(keep.slice(0, k).join(" "));
  }
  // Indian languages: the place comes before the "from" word.
  const fromAfter = new RegExp(`((?:[\\p{L}\\p{M}.]+\\s+){0,2}[\\p{L}\\p{M}.]+)\\s+(?:${alt(FROM_AFTER)})(?![\\p{L}\\p{M}])`, "giu");
  for (const m of text.matchAll(fromAfter)) {
    const ws = m[1].split(/\s+/).filter(Boolean);
    while (ws.length && STOP_BEFORE.test(ws[0])) ws.shift();
    while (ws.length && /^(?:la|lo|le|il|ki|ke|ku|nu|ni)$/i.test(ws[ws.length - 1])) ws.pop(); // "Madurai la irundhu"
    for (let k = 1; k <= ws.length; k++) push(ws.slice(ws.length - k).join(" "));
  }
  for (const w of text.split(/[\s,]+/)) {
    if (!SUFFIX_FROM.test(w)) continue;
    const stem = w.replace(SUFFIX_FROM, "");
    if (stem.length < 2) continue;
    push(stem);
    // Marathi bends a final -े into -्या before "from" (पुणे → पुण्याहून, ठाणे → ठाण्याहून): undo it.
    if (/्य$/u.test(stem)) push(stem.replace(/्य$/u, "े"));
  }
  // Small endings glued on by Tamil/Telugu speakers writing in English ("Madurai la irundhu", "Vizag lo nundi").
  const tidy = out.map((s) => s.replace(/\s+(?:la|lo|le|il|ki|ke|ku|nu|ni)$/i, "")).filter((s) => s.length >= 2);
  // Longest first within each kind is not always best ("4 rojulu Hyderabad"): lib/intake/places.ts tries them in order and keeps the first real town.
  return [...new Set(tidy)].sort((a, b) => b.split(" ").length - a.split(" ").length).slice(0, 6);
}
