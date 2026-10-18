// ═══════════════════════════════════════════════════════════════════
// src/components/layouts/OperationalLayout.tsx
// Phase 5 — Layer 1: the operational workspace chrome.
//
// This IS the existing app shell (sidebar + top bar + project context).
// The wrapper exists so the authenticated layout can switch between
// OperationalLayout and ExecutiveLayout by name, keeping the layout
// decision in exactly one place (src/routes/_authenticated/route.tsx).
// ═══════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

export function OperationalLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
