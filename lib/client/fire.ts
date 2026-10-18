// Supabase queries are LAZY: the request is only sent when something awaits the query (its then() runs). `void query` therefore
// sends NOTHING. Use this for a request whose answer nobody waits for (removing my live location when a drive stops, …).
export function fire(query: PromiseLike<unknown>): void {
  Promise.resolve(query).then(undefined, () => undefined); // a failure (offline) is not worth a crash; the next stop retries
}
