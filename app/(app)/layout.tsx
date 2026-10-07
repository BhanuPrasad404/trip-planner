import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

// Every signed-in page lives inside this frame: persistent navigation + content.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
