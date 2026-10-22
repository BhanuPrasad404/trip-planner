// Real-style trip descriptions in the languages Trailmate reads, with what a careful human reads from each. Used by the instant-reader
// tests and by the live AI check (scripts/… probe). "want" lists only what the text really says.
export type Want = {
  days?: number; month?: number; start?: string; group?: string; groupSize?: number; mode?: string; nightDriving?: boolean; pace?: string;
  endMode?: string; interests?: string[]; places?: string[]; must?: string[];
};
export type Sample = { id: string; lang: string; text: string; want: Want };

export const TRIP_TEXTS: Sample[] = [
  { id: "te-rom-1", lang: "Telugu (romanized)", text: "4 rojulu Hyderabad nundi, friends tho beaches", want: { days: 4, start: "Hyderabad", group: "friends", interests: ["beaches"] } },
  { id: "te-rom-2", lang: "Telugu (romanized)", text: "manam 5 mandi friends, 3 days Araku trip plan cheyyali, bike meeda, night driving vaddu", want: { days: 3, group: "friends", groupSize: 5, mode: "bike", nightDriving: false, places: ["Araku"] } },
  { id: "te-script", lang: "Telugu (script)", text: "హైదరాబాద్ నుండి 4 రోజులు గోవా ట్రిప్, ఫ్యామిలీ తో, పిల్లలు ఉన్నారు", want: { days: 4, start: "Hyderabad", group: "family_kids", places: ["Goa"] } },
  { id: "te-rom-3", lang: "Telugu (romanized)", text: "Vizag nundi Araku, Lambasingi, Borra caves - 2 rojulu, car lo, December lo", want: { days: 2, start: "Visakhapatnam", mode: "car", month: 12, places: ["Araku", "Lambasingi", "Borra Caves"] } },
  { id: "te-mix", lang: "Telugu + English", text: "Srisailam velli ravali, 2 days, family tho, temple darshanam, early morning start", want: { days: 2, group: "family", interests: ["temples"], endMode: "start", places: ["Srisailam"] } },
  { id: "hinglish", lang: "Hinglish", text: "Bangalore se 3 din ka trip, doston ke saath, waterfalls aur trekking pasand hai, zyada driving nahi", want: { days: 3, start: "Bengaluru", group: "friends", interests: ["nature", "adventure"], pace: "relaxed" } },
  { id: "hi-script", lang: "Hindi (script)", text: "दिल्ली से 5 दिन, परिवार के साथ, मंदिर और पहाड़, बुजुर्ग माता-पिता साथ हैं", want: { days: 5, start: "Delhi", group: "family_elders", interests: ["temples", "nature"] } },
  { id: "hi-mix", lang: "Hindi (script)", text: "मुंबई से गोवा बाइक पर 4 दिन, रात में ड्राइव नहीं", want: { days: 4, start: "Mumbai", mode: "bike", nightDriving: false, places: ["Goa"] } },
  { id: "en-1", lang: "English", text: "weekend trip from Pune, couple, food and photography, Lonavala is a must", want: { days: 2, start: "Pune", group: "couple", interests: ["food", "photography"], places: ["Lonavala"], must: ["Lonavala"] } },
  { id: "en-2", lang: "English", text: "Chennai to Pondicherry one way, 2 days, solo", want: { days: 2, start: "Chennai", group: "solo", endMode: "place", places: ["Pondicherry"] } },
  { id: "en-3", lang: "English", text: "next month 6 days Kerala trip from Kochi, honeymoon, relaxed, houseboat and Munnar", want: { days: 6, start: "Kochi", group: "couple", pace: "relaxed", places: ["Munnar"] } },
  { id: "reel", lang: "Reel caption", text: "📍 Gandikota – Grand Canyon of India 🏜️\n📍 Belum Caves\n📍 Lepakshi temple\n#andhratourism #weekendvibes #explorepage", want: { places: ["Gandikota", "Belum Caves", "Lepakshi"] } },
  { id: "ta-script", lang: "Tamil (script)", text: "சென்னையிலிருந்து 3 நாள் பாண்டிச்சேரி ட்ரிப், நண்பர்களுடன், பீச் போகணும்", want: { days: 3, start: "Chennai", group: "friends", interests: ["beaches"], places: ["Puducherry"] } },
  { id: "ta-rom", lang: "Tamil (romanized)", text: "Madurai la irundhu 2 naal Kodaikanal, family oda, kuzhandhaigal irukaanga", want: { days: 2, start: "Madurai", group: "family_kids", places: ["Kodaikanal"] } },
  { id: "kn-script", lang: "Kannada (script)", text: "ಬೆಂಗಳೂರಿನಿಂದ 2 ದಿನ ಕೂರ್ಗ್ ಪ್ರವಾಸ, ಸ್ನೇಹಿತರ ಜೊತೆ, ಜಲಪಾತ ನೋಡಬೇಕು", want: { days: 2, start: "Bengaluru", group: "friends", interests: ["nature"], places: ["Kodagu"] } },
  { id: "kn-rom", lang: "Kannada (romanized)", text: "Mysore inda 3 dina Chikmagalur, family jothe, amma appa barthare", want: { days: 3, start: "Mysuru", group: "family_elders", places: ["Chikmagalur"] } },
  { id: "mr-script", lang: "Marathi (script)", text: "पुण्याहून 2 दिवस महाबळेश्वर, मित्रांसोबत, धबधबे पाहायचे आहेत", want: { days: 2, start: "Pune", group: "friends", interests: ["nature"], places: ["Mahabaleshwar"] } },
  { id: "mr-rom", lang: "Marathi (romanized)", text: "Mumbai hun 3 divas Konkan, family sobat, samudra kinara ani mandir", want: { days: 3, start: "Mumbai", group: "family", interests: ["beaches", "temples"], places: ["Konkan"] } },
];
