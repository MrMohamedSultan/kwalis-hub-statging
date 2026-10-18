// ═══════════════════════════════════════════════════════════════════
// src/routes/_board/board.settings.tsx
// ═══════════════════════════════════════════════════════════════════
// Board Member Account Settings — Display Name, Position, Password only.
// ═══════════════════════════════════════════════════════════════════

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

import { useTranslation } from "react-i18next";
export const Route = createFileRoute("/_board/board/settings")({
  head: () => ({
    meta: [
      { title: "Board Account Settings — Kwalis HUB" },
      { name: "description", content: "Manage your board member name, position and password." },
      { property: "og:title", content: "Board Account Settings — Kwalis HUB" },
      {
        property: "og:description",
        content: "Manage your board member name, position and password.",
      },
    ],
  }),
  component: BoardSettings,
});

const profileSchema = z.object({
  display_name: z.string().trim().min(1, "Name is required").max(120),
  job_title: z.string().trim().max(120),
});

function BoardSettings() {
  const { t } = useTranslation();

  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    void loadProfile();
  }, []);

  async function loadProfile() {
    try {
      setProfileLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email || "");

      // `profiles` stores the display name and the position as `job_title`.
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, job_title")
        .eq("id", user.id)
        .maybeSingle();

      if (profile) {
        setFullName(profile.display_name || "");
        setPosition(profile.job_title || "");
      }
    } catch (err) {
      console.error("Failed to load profile:", err);
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleSaveProfile() {
    try {
      setProfileSaving(true);
      setProfileMessage(null);

      const parsed = profileSchema.safeParse({ display_name: fullName, job_title: position });
      if (!parsed.success) {
        setProfileMessage({ type: "error", text: parsed.error.issues[0].message });
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: parsed.data.display_name,
          job_title: parsed.data.job_title || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) throw error;
      setProfileMessage({ type: "success", text: "Profile updated successfully." });
    } catch (err) {
      setProfileMessage({
        type: "error",
        text: (err as Error).message || "Failed to update profile.",
      });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleChangePassword() {
    try {
      setPasswordSaving(true);
      setPasswordMessage(null);

      if (newPassword.length < 8) {
        setPasswordMessage({ type: "error", text: "Password must be at least 8 characters." });
        return;
      }
      if (newPassword !== confirmPassword) {
        setPasswordMessage({ type: "error", text: "Passwords do not match." });
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage({ type: "success", text: "Password changed successfully." });
    } catch (err) {
      setPasswordMessage({
        type: "error",
        text: (err as Error).message || "Failed to change password.",
      });
    } finally {
      setPasswordSaving(false);
    }
  }

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold text-foreground">
          {t("board_settings.account_settings")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("board_settings.manage_your_personal_information_and_security")}
        </p>
      </div>

      <section className="rounded-xl border border-border bg-surface-2 overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {t("board_settings.profile_information")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("board_settings.your_display_name_and_role_within_the_organization")}
          </p>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t("board_settings.email_address")}
            </label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground cursor-not-allowed"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {t("board_settings.email_cannot_be_changed_contact_your_administrator")}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("board_settings.enter_your_full_name")}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t("board_settings.position_title")}
            </label>
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder={t("board_settings.eg_board_member_executive_producer")}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleSaveProfile}
              disabled={profileSaving}
              className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {profileSaving ? "Saving..." : "Save Changes"}
            </button>
            {profileMessage && (
              <StatusMessage type={profileMessage.type} text={profileMessage.text} />
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-2 overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">
            {t("board_settings.change_password")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("board_settings.update_your_account_password_minimum_8_characters")}
          </p>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t("board_settings.new_password")}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("board_settings.enter_new_password")}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              {t("board_settings.confirm_new_password")}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {newPassword && (
            <div className="space-y-1">
              <PasswordRule met={newPassword.length >= 8} label="At least 8 characters" />
              <PasswordRule
                met={newPassword === confirmPassword && confirmPassword.length > 0}
                label="Passwords match"
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              onClick={handleChangePassword}
              disabled={passwordSaving || !newPassword || newPassword !== confirmPassword}
              className="px-5 py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold hover:bg-accent/80 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {passwordSaving ? "Updating..." : "Update Password"}
            </button>
            {passwordMessage && (
              <StatusMessage type={passwordMessage.type} text={passwordMessage.text} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusMessage({ type, text }: { type: "success" | "error"; text: string }) {
  return (
    <span
      className={`text-xs font-medium ${type === "success" ? "text-success" : "text-destructive"}`}
    >
      {type === "success" ? "✓" : "✕"} {text}
    </span>
  );
}

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full ${met ? "bg-success" : "bg-muted-foreground"}`} />
      <span className={`text-[11px] ${met ? "text-success" : "text-muted-foreground"}`}>
        {label}
      </span>
    </div>
  );
}
