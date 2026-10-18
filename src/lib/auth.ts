import { supabase } from "@/integrations/supabase/client";

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function signOut(): Promise<void> {
  // Clear tenant-scoped state so nothing leaks to the next user on this device.
  try {
    if (typeof window !== "undefined") {
      localStorage.removeItem("project.active.v1");
      localStorage.removeItem("project.meta.v1");
    }
  } catch {}
  await supabase.auth.signOut();
}
