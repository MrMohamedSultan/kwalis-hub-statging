/**
 * X02 — new-password rule used by the reset page: 8–72 characters (72 is
 * the bcrypt limit Supabase Auth applies), at least one letter and one digit,
 * and both fields equal. Returns a locale key suffix, or null when fine.
 */
export type PasswordProblem = "tooShort" | "tooLong" | "needsLetterAndDigit" | "mismatch";

export function passwordResetProblem(password: string, confirm: string): PasswordProblem | null {
  if (password.length < 8) return "tooShort";
  if (password.length > 72) return "tooLong";
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return "needsLetterAndDigit";
  if (password !== confirm) return "mismatch";
  return null;
}
