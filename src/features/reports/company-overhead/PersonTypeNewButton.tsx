// E04: "New contract" asks first what kind of person is added —
//   project freelancer → the contract form (instalments, payments, cash)
//   company employee   → Company Overhead: monthly cost incl. the company
//                        GOSI share and an allocation %, no instalments, never
//                        in payments or cash.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Building2, UserRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePermissions } from "@/lib/permissions/usePermissions";
import { CompanyEmployeeDialog } from "./OverheadForms";

export function PersonTypeNewButton({
  label,
  onFreelancer,
}: {
  label: string;
  onFreelancer: () => void;
}) {
  const { t } = useTranslation();
  const perms = usePermissions();
  const canAddEmployee = perms.canEdit("reports");
  const [open, setOpen] = useState(false);
  const [employee, setEmployee] = useState(false);
  const option =
    "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-start hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-brand-foreground font-semibold">
            <Plus className="size-4" />
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-1.5">
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("taxlive.person.question")}
          </div>
          <button
            type="button"
            className={option}
            onClick={() => {
              setOpen(false);
              onFreelancer();
            }}
          >
            <UserRound className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>
              <span className="block text-sm font-semibold">{t("taxlive.person.freelancer")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("taxlive.person.freelancerHint")}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={option}
            disabled={!canAddEmployee}
            onClick={() => {
              setOpen(false);
              setEmployee(true);
            }}
          >
            <Building2 className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>
              <span className="block text-sm font-semibold">{t("taxlive.person.employee")}</span>
              <span className="block text-xs text-muted-foreground">
                {canAddEmployee ? t("taxlive.person.employeeHint") : t("taxlive.oh.restricted")}
              </span>
            </span>
          </button>
        </PopoverContent>
      </Popover>
      {employee && <CompanyEmployeeDialog open onClose={() => setEmployee(false)} />}
    </>
  );
}

export default PersonTypeNewButton;
