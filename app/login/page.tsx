"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/trip/00000000-0000-0000-0000-000000000001");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-sky px-6">
      <form onSubmit={handleLogin} className="w-full max-w-sm bg-white p-6 rounded-2xl border border-line space-y-4">
        <h1 className="font-display text-2xl font-semibold text-pine">Log in to Trailmate</h1>

        <div>
          <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">Email</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-lg border border-line text-sm outline-none focus:ring-2 focus:ring-teal"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">Password</label>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-lg border border-line text-sm outline-none focus:ring-2 focus:ring-teal"
          />
        </div>

        {error && <p className="text-[12px] text-clay">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl bg-marigold text-pine font-bold text-sm disabled:opacity-60"
        >
          {loading ? "Logging in..." : "Log in"}
        </button>
      </form>
    </main>
  );
}