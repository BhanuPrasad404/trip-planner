// The words travellers use, in English, Telugu, Hindi, Tamil, Kannada and Marathi — romanized and in their own scripts.
// Used by the instant reader (no AI) and to check that what the AI read is really in the text. Add words here, nothing else changes.
// Latin words must match as whole words ("car" not "card"); Indian-script words match at the start of a word, because those languages
// add endings to the word itself ("ಬೆಂಗಳೂರಿನಿಂದ" = from Bengaluru, "బీచ్‌లు" = beaches).
import type { Group, Interest, TravelMode } from "./types";

const LATIN = /^[\x20-\x7e]+$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The word-edge checks are written ONCE per group of words, not once per word: under the "iu" flags each Unicode letter class is costly
// to compile, and repeating it for every word made the first reading of a message take 2-3 seconds (measured in Phase 3). Same matches.
function edged(whole: string[], start: string[]): RegExp {
  const group = (ws: string[]) => [...ws].sort((a, b) => b.length - a.length).map(esc).join("|");
  const parts = [
    ...(whole.length ? [`(?<![\\p{L}\\p{M}\\p{N}])(?:${group(whole)})(?![\\p{L}\\p{M}])`] : []),
    ...(start.length ? [`(?<![\\p{L}\\p{M}])(?:${group(start)})`] : []),
  ];
  return parts.length ? new RegExp(parts.join("|"), "giu") : /(?!)/gu; // an empty list matches nothing (an empty pattern would match everywhere)
}

/** One regular expression for a list of words (see the rule above). Flags: g, i, u. */
export function words(list: string[]): RegExp {
  return edged(list.filter((w) => LATIN.test(w)), list.filter((w) => !LATIN.test(w)));
}

/** Like words(), but Indian-script words of 3 letters or fewer must also END as a word (no ending glued on). */
export function wholeShortWords(list: string[]): RegExp {
  const whole = (w: string) => LATIN.test(w) || [...w].length <= 3;
  return edged(list.filter(whole), list.filter((w) => !whole(w)));
}

/** Digits in Devanagari, Telugu, Tamil and Kannada → 0-9, so "౪ రోజులు" and "४ दिन" read as 4. */
export function asciiDigits(s: string): string {
  return s.replace(/[०-९౦-౯௦-௯೦-೯]/g, (c) => {
    const code = c.charCodeAt(0);
    const base = code >= 0x0ce6 ? 0x0ce6 : code >= 0x0c66 ? 0x0c66 : code >= 0x0be6 ? 0x0be6 : 0x0966;
    return String(code - base);
  });
}

/** Number words 1–10 (and a few common forms) in each language. */
export const NUMBER_WORDS: Record<number, string[]> = {
  1: ["one", "okati", "ek", "onnu", "ondru", "ondu", "ఒకటి", "ఒక", "एक", "ஒன்று", "ஒரு", "ಒಂದು"],
  2: ["two", "rendu", "do", "irandu", "eradu", "don", "రెండు", "दो", "இரண்டு", "ரெண்டு", "ಎರಡು", "दोन"],
  3: ["three", "moodu", "mudu", "moodu", "teen", "moonu", "moondru", "mooru", "మూడు", "तीन", "மூன்று", "ಮೂರು"],
  4: ["four", "nalugu", "naalugu", "char", "chaar", "naalu", "naangu", "naalku", "నాలుగు", "चार", "நான்கு", "நாலு", "ನಾಲ್ಕು"],
  5: ["five", "aidu", "ayidu", "paanch", "panch", "anju", "ainthu", "paach", "ఐదు", "पांच", "पाँच", "ஐந்து", "அஞ்சு", "ಐದು", "पाच"],
  6: ["six", "aaru", "aru", "chhe", "che", "chhah", "saha", "ఆరు", "छह", "छः", "ஆறு", "ಆರು", "सहा"],
  7: ["seven", "edu", "eedu", "saat", "ezhu", "elu", "ఏడు", "सात", "ஏழு", "ಏಳು"],
  8: ["eight", "enimidi", "aath", "ettu", "entu", "ఎనిమిది", "आठ", "எட்டு", "ಎಂಟು"],
  9: ["nine", "tommidi", "nau", "ombadhu", "ombattu", "తొమ్మిది", "नौ", "नऊ", "ஒன்பது", "ಒಂಬತ್ತು"],
  10: ["ten", "padi", "das", "pathu", "hattu", "daha", "పది", "दस", "दहा", "பத்து", "ಹತ್ತು"],
};
const NUMBER_INDEX = new Map<string, number>();
for (const [n, list] of Object.entries(NUMBER_WORDS)) for (const w of list) NUMBER_INDEX.set(w.toLowerCase(), Number(n));
export const numberWord = (w: string): number | null => NUMBER_INDEX.get(w.toLowerCase()) ?? null;
export const NUMBER = `(\\d{1,2}|${[...NUMBER_INDEX.keys()].sort((a, b) => b.length - a.length).map(esc).join("|")})`;

export const DAY_UNITS = ["days", "day", "din", "dino", "dinon", "dinam", "rojulu", "roju", "rojula", "rojulo", "naal", "naatkal", "naalu", "dina", "dinagalu", "divas", "diwas",
  "రోజులు", "రోజుల", "రోజు", "दिन", "दिवस", "நாள்", "நாட்கள்", "நாட்கள", "ದಿನ", "ದಿನಗಳು"];
export const NIGHT_UNITS = ["nights", "night", "raat", "raatein", "రాత్రులు", "रात", "रातें", "रात्री", "இரவு", "ರಾತ್ರಿ"];
export const WEEKEND = ["weekend", "week end", "वीकेंड", "వీకెండ్", "வீக்கெண்ட்", "ವೀಕೆಂಡ್"];
export const WEEK = ["a week", "one week", "1 week", "oka vaaram", "ek hafta", "एक हफ्ता", "ఒక వారం", "ஒரு வாரம்", "ಒಂದು ವಾರ", "एक आठवडा"];

// ("jan" and "per" are left out on purpose: "5 jan" is a date and "per day" is not people.)
export const PEOPLE_UNITS = ["people", "persons", "members", "of us", "mandi", "mandhi", "log", "jana", "janaru", "peru", "jan log", "జనం", "మంది", "लोग", "जण", "பேர்", "ಜನ"];

export const GROUP_WORDS: [Group, string[]][] = [
  ["family_kids", ["kids", "children", "child", "baby", "toddler", "pillalu", "pillala", "bachche", "bacche", "bachon", "kuzhandhaigal", "kozhandhainga", "makkalu", "mule", "mulanna", "పిల్లలు", "పిల్లల", "बच्चे", "बच्चों", "குழந்தை", "ಮಕ್ಕಳ", "मुले", "मुलं"]],
  ["family_elders", ["elders", "elderly", "parents", "grandparents", "senior citizens", "old parents", "amma nanna", "ammanana", "buzurg", "mummy papa", "maa baap", "appa amma", "amma appa", "ammaa appa", "aai baba", "ajji", "thatha", "అమ్మానాన్న", "అమ్మ నాన్న", "పెద్దవాళ్ళు", "बुजुर्ग", "माता-पिता", "माता पिता", "பெற்றோர்", "ಅಪ್ಪ ಅಮ್ಮ", "ಅಮ್ಮ ಅಪ್ಪ", "ಹಿರಿಯ", "आई बाबा", "ज्येष्ठ"]],
  ["family", ["family", "fam", "kutumbam", "parivar", "parivaar", "kudumbam", "kutumba", "kutumb", "ఫ్యామిలీ", "కుటుంబ", "परिवार", "फैमिली", "फॅमिली", "कुटुंब", "குடும்ப", "ಕುಟುಂಬ", "ಫ್ಯಾಮಿಲಿ"]],
  ["couple", ["couple", "honeymoon", "wife", "husband", "partner", "girlfriend", "boyfriend", "spouse", "జంట", "భార్య", "హనీమూన్", "पत्नी", "हनीमून", "மனைவி", "ಹೆಂಡತಿ", "बायको"]],
  ["friends", ["friends", "friend", "frnds", "gang", "dosth", "dosthulu", "dost", "doston", "dosto", "snehitulu", "mitrulu", "nanbargal", "nanbanga", "nanbar", "geleyaru", "snehitaru", "mitra", "mitranbarobar", "మిత్రు", "స్నేహితు", "ఫ్రెండ్స్", "दोस्त", "मित्र", "நண்பர்", "ப்ரெண்ட்ஸ்", "ಗೆಳೆಯ", "ಸ್ನೇಹಿತ", "ಫ್ರೆಂಡ್ಸ್"]],
  ["solo", ["solo", "alone", "by myself", "on my own", "okkadine", "okkate", "akela", "akele", "akeli", "thaniya", "thaniyaaga", "obbane", "obbale", "ekta", "ekti", "ఒంటరిగా", "अकेले", "अकेला", "अकेली", "தனியாக", "ಒಬ್ಬನೇ", "ಒಬ್ಬಳೇ", "एकटा", "एकटी"]],
];

export const MODE_WORDS: [TravelMode, string[]][] = [
  ["bike", ["bike", "bikes", "motorcycle", "motorbike", "bullet", "royal enfield", "scooty", "two wheeler", "బైక్", "बाइक", "बाईक", "பைக்", "ಬೈಕ್"]],
  ["car", ["car", "cars", "own car", "suv", "self drive", "కారు", "కార్", "कार", "கார்", "ಕಾರು", "ಕಾರ್"]],
  ["bus", ["bus", "buses", "volvo", "rtc", "బస్సు", "బస్", "बस", "பஸ்", "பேருந்து", "ಬಸ್"]],
  ["train", ["train", "trains", "railway", "రైలు", "ట్రైన్", "ट्रेन", "रेल", "रेल्वे", "ரயில்", "ட்ரெயின்", "ರೈಲು", "ಟ್ರೈನ್"]],
];

export const NIGHT_WORDS = ["night", "nights", "night driving", "raat", "raat ko", "rathri", "ratri", "iravu", "rattri", "రాత్రి", "రాత్రుళ్ళు", "रात", "रात्री", "இரவு", "ராத்திரி", "ರಾತ್ರಿ"];
export const NEGATION = ["no", "not", "avoid", "never", "dont", "don't", "vaddu", "vadhu", "nahi", "nahin", "mat", "nako", "naka", "venda", "vendam", "vendaam", "beda", "bedaa",
  "వద్దు", "నహీ", "नहीं", "नही", "मत", "नको", "வேண்டாம்", "வேணாம்", "ಬೇಡ"];

export const RELAXED = ["relaxed", "relax", "chill", "slow", "slowly", "leisure", "leisurely", "not too much driving", "less driving", "zyada driving nahi", "kam driving", "takkuva driving", "aaram se", "aaramse", "nidhanam", "nidhanamga", "nivant", "aaramaga",
  "आराम", "निवांत", "నిదానంగా", "తక్కువ డ్రైవింగ్", "நிதானமா", "ನಿಧಾನವಾಗಿ"];
export const PACKED = ["packed", "cover maximum", "cover max", "maximum places", "max places", "as many places", "as many as possible", "ekkuva places", "zyada jagah", "jitna ho sake", "full packed", "jam packed"];

export const INTEREST_WORDS: [Interest, string[]][] = [
  ["beaches", ["beach", "beaches", "sea", "seaside", "coast", "samudram", "samudra", "samundar", "kadal", "kadarkarai", "समुद्र", "समुंदर", "बीच", "సముద్ర", "బీచ్", "கடல்", "கடற்கரை", "பீச்", "ಸಮುದ್ರ", "ಬೀಚ್", "किनारा"]],
  ["temples", ["temple", "temples", "gudi", "gullu", "devalayam", "darshan", "darshanam", "mandir", "mandirs", "kovil", "koil", "devasthana", "devasthanam", "pilgrimage", "jyotirlinga", "teerth", "tirth", "yatra",
    "మందిర", "గుడి", "గుళ్ళు", "దేవాలయ", "దర్శన", "मंदिर", "दर्शन", "तीर्थ", "கோவில்", "கோயில்", "ದೇವಸ್ಥಾನ", "ದೇವಾಲಯ", "ದೇಗುಲ", "देऊळ", "देवळ"]],
  ["nature", ["nature", "waterfall", "waterfalls", "falls", "hill", "hills", "hill station", "mountain", "mountains", "forest", "lake", "lakes", "river", "valley", "greenery", "kondalu", "konda", "jalapatham", "pahad", "pahar", "pahaad", "jharna", "jungle", "malai", "aruvi", "betta", "kaadu", "nisarg", "dongar",
    "కొండ", "జలపాత", "అడవి", "పహాడ", "पहाड़", "पहाड", "झरना", "झरने", "जंगल", "मलै", "மலை", "அருவி", "காடு", "ಬೆಟ್ಟ", "ಜಲಪಾತ", "ಕಾಡು", "धबधब", "डोंगर", "निसर्ग"]],
  ["food", ["food", "foodie", "biryani", "street food", "cuisine", "khana", "khaana", "bhojanam", "saapadu", "sapadu", "oota", "jevan", "भोजन", "खाना", "భోజన", "బిర్యానీ", "சாப்பாடு", "ಊಟ", "जेवण"]],
  ["adventure", ["trek", "treks", "trekking", "hike", "hiking", "adventure", "rafting", "paragliding", "camping", "scuba", "rappelling", "bungee", "ట్రెక్", "ट्रेक", "ட்ரெக்", "ಟ್ರೆಕ್"]],
  ["photography", ["photo", "photos", "photography", "pics", "insta", "instagram", "reels", "sunrise", "sunset", "फोटो", "ఫోటో", "போட்டோ", "ಫೋಟೋ"]],
  ["offbeat", ["offbeat", "off beat", "hidden", "less crowded", "not crowded", "unexplored", "crowd lekunda", "kam bheed"]],
  ["shopping", ["shopping", "market", "markets", "bazaar", "bazar", "बाजार", "बाज़ार", "మార్కెట్", "ஷாப்பிங்", "ಶಾಪಿಂಗ್"]],
  ["history", ["history", "historical", "heritage", "fort", "forts", "monument", "monuments", "ruins", "palace", "palaces", "kota", "kila", "qila", "killa", "kottai", "kote", "museum",
    "కోట", "किला", "किले", "किल्ला", "கோட்டை", "ಕೋಟೆ"]],
];

/**
 * Month names: English, Hindi/Marathi (Devanagari), Telugu, Tamil, Kannada. Short English forms only where they can't be ordinary words.
 * The very short Indian-script ones ("मे", "మే") are matched as WHOLE words only (see monthWords): "में" (in) must not read as May.
 */
export const MONTH_WORDS: string[][] = [
  ["january", "jan", "जनवरी", "जानेवारी", "జనవరి", "ஜனவரி", "ಜನವರಿ"],
  ["february", "feb", "फरवरी", "फ़रवरी", "फेब्रुवारी", "ఫిబ్రవరి", "பிப்ரவரி", "ಫೆಬ್ರವರಿ"],
  ["march", "मार्च", "మార్చి", "மார்ச்", "ಮಾರ್ಚ್"],
  ["april", "apr", "अप्रैल", "एप्रिल", "ఏప్రిల్", "ஏப்ரல்", "ಏಪ್ರಿಲ್"],
  ["मई", "मे", "మే", "மே", "ಮೇ"], // English "may" is handled separately (it is also an ordinary word)
  ["june", "jun", "जून", "జూన్", "ஜூன்", "ಜೂನ್"],
  ["july", "jul", "जुलाई", "जुलै", "జూలై", "ஜூலை", "ಜುಲೈ"],
  ["august", "aug", "अगस्त", "ऑगस्ट", "ఆగస్టు", "ஆகஸ்ட்", "ಆಗಸ್ಟ್"],
  ["september", "sept", "sep", "सितंबर", "सितम्बर", "सप्टेंबर", "సెప్టెంబర్", "செப்டம்பர்", "ಸೆಪ್ಟೆಂಬರ್"],
  ["october", "oct", "अक्टूबर", "ऑक्टोबर", "అక్టోబర్", "அக்டோபர்", "ಅಕ್ಟೋಬರ್"],
  ["november", "nov", "नवंबर", "नवम्बर", "नोव्हेंबर", "నవంబర్", "நவம்பர்", "ನವೆಂಬರ್"],
  ["december", "dec", "दिसंबर", "दिसम्बर", "डिसेंबर", "డిసెంబర్", "டிசம்பர்", "ಡಿಸೆಂಬರ್"],
];
/** English "May" counts only as a capitalised word or after a time word ("in may", "may lo"). */
export const ENGLISH_MAY = /(?<![\p{L}])May(?![\p{L}])|(?:in|during|this|next|mid|early|late|end of)\s+may(?![\p{L}])|(?<![\p{L}])may\s+(?:lo|me|mein|la|alli|madhe)(?![\p{L}])/u;
export const NEXT_MONTH = ["next month", "agle mahine", "agla mahina", "vachhe nela", "vache nela", "vachche nela", "adutha maasam", "mundina tingalu", "pudhchya mahinyat", "अगले महीने", "వచ్చే నెల", "அடுத்த மாதம்", "ಮುಂದಿನ ತಿಂಗಳು", "पुढच्या महिन्यात"];
export const THIS_MONTH = ["this month", "is mahine", "ee nela", "indha maasam", "ee tingalu", "ya mahinyat", "इस महीने", "ఈ నెల", "இந்த மாதம்", "ಈ ತಿಂಗಳು", "या महिन्यात"];

/** "from X": the word comes AFTER the place in Indian languages ("Hyderabad nundi", "दिल्ली से", "ಬೆಂಗಳೂರಿನಿಂದ"), before it in English. */
export const FROM_AFTER = ["nundi", "nunchi", "nunci", "se", "say", "pasun", "pasoon", "hun", "hoon", "irundhu", "ilirundhu", "lirundhu", "inda", "ninda", "nunda",
  "నుండి", "నుంచి", "से", "पासून", "हून", "इथून", "இருந்து", "லிருந்து", "ಇಂದ", "ನಿಂದ"];
export const ONE_WAY = ["one way", "oneway", "one-way", "single side", "ekatarafa", "ek taraf", "एक तरफ़ा", "एक तरफा"];
export const ROUND_TRIP = ["round trip", "return", "come back", "back home", "velli ravali", "velli vaddam", "vellochu", "wapas", "vapas", "aana jaana", "tirigi", "poittu varalam", "hogi barona", "jaun yeu",
  "వెళ్ళి రావాలి", "తిరిగి", "वापस", "वापसी", "திரும்பி", "ಹಿಂತಿರುಗಿ", "परत"];
export const MUST = ["must", "must see", "must visit", "definitely", "pakka", "kachitanga", "zaroor", "zarur", "kandippa", "khandita", "nakki", "jarur",
  "తప్పకుండా", "కచ్చితంగా", "ज़रूर", "जरूर", "पक्का", "கண்டிப்பா", "ಖಂಡಿತ", "नक्की"];
export const DRIVE_WORDS = ["drive", "driving", "drives", "travel time", "ड्राइव", "ड्राइविंग", "డ్రైవ్", "డ్రైవింగ్", "டிரைவ்", "ಡ್ರೈವ್", "ಡ್ರೈವಿಂಗ್"];
export const HOUR_UNITS = ["hours", "hour", "hrs", "hr", "gantalu", "ganta", "gante", "ghante", "ghanta", "mani", "mani neram", "ganTe", "taas", "tas",
  "గంటలు", "గంట", "घंटे", "घंटा", "மணி", "மணிநேரம்", "ಗಂಟೆ", "तास"];

/** Hashtags that are never place names. */
export const GENERIC_TAGS = /^(travel|travels|traveller|travelgram|travelphotography|explore|explorepage|explorer|wanderlust|weekend|weekendvibes|weekendgetaway|roadtrip|trip|tour|tourism|india|incredibleindia|indiatourism|instagood|photography|reels|reel|viral|trending|nature|naturelovers|mountains|beach|beaches|travelblogger|fyp|foryou|love|instagram|insta|vibes|getaway|backpacking|solotravel|adventure|hiking|trekking|monsoon|vacation|holiday|holidays|bucketlist|[a-z]+tourism|[a-z]+diaries|[a-z]+travels?)$/i;

export const MODE_GROUP_INTEREST = { MODE_WORDS, GROUP_WORDS, INTEREST_WORDS };
