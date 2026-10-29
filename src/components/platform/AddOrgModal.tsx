// ═══════════════════════════════════════════════════════════════════
// AddOrgModal — create a new tenant organization (Platform Hub).
// Super-admin only surface; RLS on public.organizations enforces it.
// ═══════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  SUBSCRIPTION_STATUSES,
  subscriptionStatusLabel,
  type SubscriptionStatus,
} from "@/lib/subscription-status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const OrgSchema = z.object({
  name: z.string().trim().min(2, "closeout.ui.org.err_name").max(120),
  industry: z.string().trim().max(80),
  contact_email: z.string().trim().email("closeout.ui.org.err_email").or(z.literal("")),
  subscription_status: z.enum(SUBSCRIPTION_STATUSES),
});

export function AddOrgModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubscriptionStatus>("trial");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const parsed = OrgSchema.safeParse({
      name,
      industry,
      contact_email: email,
      subscription_status: status,
    });
    if (!parsed.success) {
      // zod messages are i18n keys (D19)
      toast.error(t(parsed.error.issues[0]?.message ?? "closeout.ui.invalid_input"));
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
      toast.success(t("closeout.ui.org.created"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("closeout.ui.org.create_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("closeout.ui.org.add_title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">{t("closeout.ui.org.name")}</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("closeout.ui.org.name_ph")}
              maxLength={120}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-industry">{t("closeout.ui.org.industry")}</Label>
            <Input
              id="org-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder={t("closeout.ui.org.industry_ph")}
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-email">{t("closeout.ui.org.email")}</Label>
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
            <Label>{t("closeout.ui.org.subscription")}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as SubscriptionStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {subscriptionStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? t("closeout.ui.org.creating") : t("closeout.ui.org.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
