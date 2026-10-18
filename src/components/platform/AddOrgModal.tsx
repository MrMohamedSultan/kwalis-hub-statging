// ═══════════════════════════════════════════════════════════════════
// AddOrgModal — create a new tenant organization (Platform Hub).
// Super-admin only surface; RLS on public.organizations enforces it.
// ═══════════════════════════════════════════════════════════════════

import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const OrgSchema = z.object({
  name: z.string().trim().min(2, "Company name is required").max(120),
  industry: z.string().trim().max(80),
  contact_email: z.string().trim().email("Enter a valid email address").or(z.literal("")),
  subscription_status: z.enum(["Trial", "Active", "Suspended", "Cancelled"]),
});

type SubscriptionStatus = "Trial" | "Active" | "Suspended" | "Cancelled";

export function AddOrgModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubscriptionStatus>("Trial");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const parsed = OrgSchema.safeParse({
      name,
      industry,
      contact_email: email,
      subscription_status: status,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setSaving(true);
    try {
      const slug =
        parsed.data.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || `org-${Date.now()}`;
      const { error } = await supabase.from("organizations").insert({
        name: parsed.data.name,
        slug: `${slug}-${Math.random().toString(36).slice(2, 7)}`,
        industry: parsed.data.industry || null,
        contact_email: parsed.data.contact_email || null,
        subscription_status: parsed.data.subscription_status,
      });
      if (error) throw error;
      toast.success("Company created");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create company");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Client Company</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Company name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Neom Pictures"
              maxLength={120}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-industry">Industry</Label>
            <Input
              id="org-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Film & TV Production"
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-email">Contact email</Label>
            <Input
              id="org-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ops@company.com"
              maxLength={160}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Subscription status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as SubscriptionStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Trial">Trial</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Suspended">Suspended</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Creating…" : "Create Company"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
