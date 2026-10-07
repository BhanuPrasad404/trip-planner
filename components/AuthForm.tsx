"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "./ui/Button";
import { FormError, TextField } from "./ui/Field";

type AuthFormProps = { mode: "login" | "signup"; next: string; initialError?: string | null };

export function AuthForm({ mode, next, initialError = null }: AuthFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (isSignup && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();

      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() || undefined },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) return setError(error.message);

        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          // Email confirmation is enabled in Supabase — the user must click the link first.
          setNotice("Check your inbox — we sent a confirmation link to finish creating your account.");
        }
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return setError(error.message);
      router.push(next);
      router.refresh();
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const otherHref = `${isSignup ? "/login" : "/signup"}${next !== "/trips" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="w-full max-w-md space-y-5 rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8"
    >
      <div>
        <h1 className="font-display text-3xl font-semibold text-pine">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1.5 text-base text-ink-muted">
          {isSignup ? "Start planning trips that know when to go." : "Log in to see your trips."}
        </p>
      </div>

      {isSignup && (
        <TextField
          label="Your name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Shown to your travel group"
          maxLength={60}
        />
      )}

      <TextField
        label="Email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <TextField
        label="Password"
        type="password"
        required
        autoComplete={isSignup ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={isSignup ? "At least 8 characters." : undefined}
      />

      <FormError message={error} />
      {notice && (
        <p role="status" className="rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">
          {notice}
        </p>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? (isSignup ? "Creating account…" : "Logging in…") : isSignup ? "Create account" : "Log in"}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        {isSignup ? "Already have an account? " : "New to Trailmate? "}
        <Link href={otherHref} className="font-semibold text-teal-ink underline underline-offset-2">
          {isSignup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
