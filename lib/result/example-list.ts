// The ready-made example plans, as a light list for links (the plans themselves are in data/examples, loaded only on their page).
// tests/result-screen.render.test.tsx checks this list matches lib/result/examples.ts.
export const EXAMPLE_LINKS = [
  { slug: "chennai-puducherry", title: "Chennai → Mahabalipuram → Puducherry", blurb: "2 days by car · temples, a fort and the sea" },
  { slug: "kochi-munnar-alleppey", title: "Kochi → Munnar → Alleppey", blurb: "4 days by car · tea hills, a dam, backwaters and a beach" },
] as const;
