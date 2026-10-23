import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResultView } from "@/components/result/ResultView";
import { exampleBySlug } from "@/lib/result/examples";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Example plan", description: "A real trip plan made with live road data: see what Trailmate gives you before you sign up." };

// A ready-made, real example plan for new visitors. Open to everyone; signing up is only asked at "Save this trip".
export default async function ExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const example = exampleBySlug(slug);
  if (!example) notFound();
  let signedIn = false;
  try { signedIn = !!(await (await createClient()).auth.getUser()).data.user; } catch { /* auth unreachable: treat as a guest */ }
  return (
    <main id="main" className="flex-1">
      <ResultView kind="example" example={example} signedIn={signedIn} />
    </main>
  );
}
