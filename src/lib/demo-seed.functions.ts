import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Seed a Demo/Sandbox project with realistic $5M-$6M feature-film data.
 * Hard fail-safe: rejects unless project name contains "demo" or "sandbox".
 * Requires the caller to be an org admin (or super admin) of the project's org.
 */
export const seedDemoProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const projectId = data.projectId;

    // 1) Load project & verify permissions + demo name guard.
    const { data: proj, error: pErr } = await supabase
      .from("projects")
      .select("id,name,organization_id,budget_status")
      .eq("id", projectId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!proj) throw new Error("Project not found.");
    const nm = (proj.name ?? "").toLowerCase();
    if (!/(demo|sandbox)/.test(nm)) {
      throw new Error("Refusing to seed: project name must contain 'Demo' or 'Sandbox'.");
    }
    const orgId = proj.organization_id;
    if (!orgId) throw new Error("Project has no organization.");

    // Verify caller is super admin OR org admin (defence in depth over RLS).
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _uid: userId });
    const { data: isAdmin } = await supabase.rpc("is_org_admin", { _uid: userId, _org: orgId });
    if (!isSuper && !isAdmin) throw new Error("Only org admins can seed demo data.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 2) Wipe existing project-scoped rows (safe: only demo/sandbox project).
    const tablesToClear = [
      "daily_transports",
      "car_rentals",
      "accommodations",
      "purchase_orders",
      "invoices",
      "cash_advances",
      "budget_lines",
      "vendors",
      "people",
      "crew_members",
    ] as const;
    const cleared: Record<string, number> = {};
    for (const t of tablesToClear) {
      const { data: del } = await supabaseAdmin
        .from(t)
        .delete()
        .eq("project_id", projectId)
        .select("id");
      cleared[t] = del?.length ?? 0;
    }
    const created: Record<string, number> = {};
    const countInsert = async (table: string, res: { data: unknown[] | null }) => {
      created[table] = (created[table] ?? 0) + (res.data?.length ?? 0);
    };

    // 3) Budget Top Sheet — 10 lines totaling ~$5.5M
    const budgetRows = [
      {
        header_code: "1000",
        main_code: "1100-01",
        description: "Screenplay & Rights",
        rate: 250000,
        amount: 1,
        group: "ATL",
        prep: 0,
        shooting: 0,
        wrap: 0,
      },
      {
        header_code: "1000",
        main_code: "1200-01",
        description: "Producer Fees",
        rate: 450000,
        amount: 1,
        group: "ATL",
        prep: 0,
        shooting: 0,
        wrap: 0,
      },
      {
        header_code: "1000",
        main_code: "1300-01",
        description: "Director Fee",
        rate: 600000,
        amount: 1,
        group: "ATL",
        prep: 0,
        shooting: 0,
        wrap: 0,
      },
      {
        header_code: "1000",
        main_code: "1400-01",
        description: "Principal Cast",
        rate: 900000,
        amount: 1,
        group: "ATL",
        prep: 0,
        shooting: 0,
        wrap: 0,
      },
      {
        header_code: "2000",
        main_code: "2100-01",
        description: "Crew Payroll",
        rate: 15000,
        amount: 60,
        group: "BTL",
        prep: 10,
        shooting: 40,
        wrap: 10,
      },
      {
        header_code: "2000",
        main_code: "2200-01",
        description: "Camera & Lenses",
        rate: 18000,
        amount: 35,
        group: "BTL",
        prep: 5,
        shooting: 30,
        wrap: 0,
      },
      {
        header_code: "2000",
        main_code: "2300-01",
        description: "Lighting & Grip",
        rate: 14000,
        amount: 35,
        group: "BTL",
        prep: 5,
        shooting: 30,
        wrap: 0,
      },
      {
        header_code: "2000",
        main_code: "2400-01",
        description: "Locations & Permits",
        rate: 350000,
        amount: 1,
        group: "BTL",
        prep: 20,
        shooting: 40,
        wrap: 0,
      },
      {
        header_code: "2000",
        main_code: "2500-01",
        description: "Catering & Craft",
        rate: 8000,
        amount: 45,
        group: "BTL",
        prep: 5,
        shooting: 40,
        wrap: 0,
      },
      {
        header_code: "3000",
        main_code: "3100-01",
        description: "Post-Production (Edit/VFX/Sound)",
        rate: 850000,
        amount: 1,
        group: "POST",
        prep: 0,
        shooting: 0,
        wrap: 60,
      },
    ].map((b) => ({
      ...b,
      unit: "Flat",
      x: 1,
      currency: "USD",
      organization_id: orgId,
      project_id: projectId,
    }));
    await countInsert(
      "budget_lines",
      await supabaseAdmin
        .from("budget_lines")
        .insert(budgetRows as any)
        .select("id"),
    );

    // 4) Lock the budget
    await supabaseAdmin
      .from("projects")
      .update({ budget_status: "Locked/Approved" })
      .eq("id", projectId);

    // 5) Accommodations (2 hotels) — need person_id, we'll create people first below and re-link.
    //    Create as free-standing rows without person_id? Table requires person_id NOT NULL — attach to first two crew below.

    // 6) Crew (5) — 1 driver + 3 requiring transport
    const crewSeed = [
      {
        full_name: "Ahmed Al-Sayed",
        role: "Line Producer",
        nationality: "Saudi Arabia",
        is_driver: false,
        requires_transport: false,
      },
      {
        full_name: "Mona Al-Fahad",
        role: "1st AD",
        nationality: "Saudi Arabia",
        is_driver: false,
        requires_transport: true,
      },
      {
        full_name: "Yasser Khoury",
        role: "DoP",
        nationality: "Lebanon",
        is_driver: false,
        requires_transport: true,
      },
      {
        full_name: "Nora Bassam",
        role: "Costume Designer",
        nationality: "Egypt",
        is_driver: false,
        requires_transport: true,
      },
      {
        full_name: "Turki Al-Otaibi",
        role: "Unit Driver",
        nationality: "Saudi Arabia",
        is_driver: true,
        requires_transport: false,
      },
    ];
    const crewInsert = crewSeed.map((c, i) => ({
      organization_id: orgId,
      project_id: projectId,
      full_name: c.full_name,
      role: c.role,
      nationality: c.nationality,
      iban: `SA03800000000000000${(i + 10).toString().padStart(4, "0")}`,
      phone: `+9665000000${(20 + i).toString().padStart(2, "0")}`,
      email: `${c.full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@demo.kwalishub.com`,
      contract_status: "Active",
      header_code: "2000",
      sub_account_code: "2100-01",
      total_deal: 25000 + i * 3500,
      deal_currency: "USD",
    }));
    const { data: crewRowsRaw } = await supabaseAdmin
      .from("crew_members")
      .insert(crewInsert as any)
      .select("id,full_name,role");
    created["crew_members"] = crewRowsRaw?.length ?? 0;
    type CrewSeed = {
      id: string;
      full_name: string;
      role: string;
      is_driver: boolean;
      requires_transport: boolean;
    };
    const crewRows: CrewSeed[] = (
      (crewRowsRaw ?? []) as Array<{ id: string; full_name: string; role: string }>
    ).map((r, i) => ({
      ...r,
      is_driver: crewSeed[i]?.is_driver ?? false,
      requires_transport: crewSeed[i]?.requires_transport ?? false,
    }));

    // 7) Cast (2) as `people` rows (kind='cast')
    const castInsert = [
      { full_name: "Layla Hassan", character: "Amira", nationality: "Saudi Arabia" },
      { full_name: "Omar Farid", character: "Faris", nationality: "Jordan" },
    ].map((c) => ({
      organization_id: orgId,
      project_id: projectId,
      kind: "cast",
      full_name: c.full_name,
      character: c.character,
      nationality: c.nationality,
      start_date: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
      shooting_days: 30,
      daily_rate: 5000,
      per_diem: 300,
      ccy: "USD",
      contract_status: "Active",
    }));
    await countInsert(
      "cast (people)",
      await supabaseAdmin
        .from("people")
        .insert(castInsert as any)
        .select("id"),
    );

    // Create 2 crew-person rows to attach accommodations to (required by FK)
    const personGuestsRaw = crewRows?.slice(0, 2) ?? [];
    const personInsert = personGuestsRaw.map((c) => ({
      organization_id: orgId,
      project_id: projectId,
      kind: "crew",
      full_name: c.full_name,
      position: "Crew",
      shooting_days: 40,
      daily_rate: 1200,
      per_diem: 150,
      ccy: "USD",
      contract_status: "Active",
    }));
    const { data: personRows } = await supabaseAdmin
      .from("people")
      .insert(personInsert as any)
      .select("id,full_name");
    created["crew (people)"] = personRows?.length ?? 0;

    // 8) Accommodations (2 hotels)
    const hotels = ["Ritz-Carlton Riyadh", "Movenpick Jeddah"];
    const accomInsert = ((personRows ?? []) as Array<{ id: string }>).slice(0, 2).map((p, i) => ({
      organization_id: orgId,
      project_id: projectId,
      person_id: p.id,
      hotel_name: hotels[i] ?? hotels[0],
      room_number: `${1200 + i * 12}`,
      check_in_date: new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10),
      check_out_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      notes: "Demo accommodation",
    }));
    if (accomInsert.length) {
      await countInsert(
        "accommodations",
        await supabaseAdmin
          .from("accommodations")
          .insert(accomInsert as any)
          .select("id"),
      );
    } else {
      created["accommodations"] = 0;
    }

    // 9) Car Rentals (2 vehicles)
    const driver = crewRows?.find((c) => c.is_driver);
    const carInsert = [
      { make_model: "Toyota Hiace Van", license_plate: "RUH-8821", daily_rate: 350 },
      { make_model: "GMC Yukon SUV", license_plate: "RUH-4412", daily_rate: 480 },
    ].map((v) => ({
      organization_id: orgId,
      project_id: projectId,
      make_model: v.make_model,
      license_plate: v.license_plate,
      vendor_name: "Budget Rent-A-Car KSA",
      daily_rate: v.daily_rate,
      currency: "SAR",
      rental_start_date: new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10),
      rental_end_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      driver_name: driver?.full_name ?? null,
    }));
    const { data: carRows } = await supabaseAdmin
      .from("car_rentals")
      .insert(carInsert as any)
      .select("id,make_model");
    created["car_rentals"] = carRows?.length ?? 0;

    // 10) Daily Transport Sheet (1 entry)
    created["daily_transports"] = 0;
    if (carRows && carRows.length > 0) {
      const passengers = (crewRows ?? [])
        .filter((c) => c.requires_transport)
        .slice(0, 3)
        .map((c) => c.id);
      const dt = await supabaseAdmin
        .from("daily_transports")
        .insert({
          organization_id: orgId,
          project_id: projectId,
          transport_date: new Date().toISOString().slice(0, 10),
          pickup_time: "06:30",
          passenger_ids: passengers,
          pickup_location: hotels[0],
          dropoff_location: "Studio Set — Diriyah Backlot",
          car_rental_id: carRows[0].id,
          vehicle_label: carRows[0].make_model,
          driver_name: driver?.full_name ?? "Unit Driver",
          notes: "Demo call sheet AM run",
        } as any)
        .select("id");
      created["daily_transports"] = dt.data?.length ?? 0;
    }

    // 11) Vendor Invoices (3)
    const today = new Date();
    const dayOffset = (d: number) =>
      new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10);
    await countInsert(
      "invoices",
      await supabaseAdmin
        .from("invoices")
        .insert([
          {
            organization_id: orgId,
            project_id: projectId,
            description: "Camera package — week 1",
            department: "Camera",
            budget_code: "2200-01",
            price: 42000,
            vatable: true,
            date: dayOffset(20),
            invoice_no: "INV-D-1001",
            vendor_name: "Riyadh Camera Rentals",
            purchaser_name: "Line Producer",
            payment_term: 30,
          },
          {
            organization_id: orgId,
            project_id: projectId,
            description: "Lighting & grip package",
            department: "Grip",
            budget_code: "2300-01",
            price: 28500,
            vatable: true,
            date: dayOffset(15),
            invoice_no: "INV-D-1002",
            vendor_name: "Jeddah Lights & Grip",
            purchaser_name: "Line Producer",
            payment_term: 30,
          },
          {
            organization_id: orgId,
            project_id: projectId,
            description: "Location fee — Diriyah",
            department: "Loc",
            budget_code: "2400-01",
            price: 12000,
            vatable: false,
            date: dayOffset(8),
            invoice_no: "INV-D-1003",
            vendor_name: "Diriyah Studios",
            purchaser_name: "Producer",
            payment_term: 15,
          },
        ] as any)
        .select("id"),
    );

    // 12) Petty Cash (2)
    await countInsert(
      "cash_advances",
      await supabaseAdmin
        .from("cash_advances")
        .insert([
          {
            organization_id: orgId,
            project_id: projectId,
            holder: "Mona Al-Fahad",
            total_advance: 5000,
            expenses: 3200,
            status: "Open",
          },
          {
            organization_id: orgId,
            project_id: projectId,
            holder: "Nora Bassam",
            total_advance: 3500,
            expenses: 3500,
            status: "Closed",
          },
        ] as any)
        .select("id"),
    );

    // 13) Purchase Order (1)
    await countInsert(
      "purchase_orders",
      await supabaseAdmin
        .from("purchase_orders")
        .insert([
          {
            organization_id: orgId,
            project_id: projectId,
            po_number: "PO-D-2001",
            vendor_name: "Al-Falak Catering",
            description: "Crew meals — 40 shoot days",
            budget_code: "2500-01",
            amount: 72000,
            status: "Approved",
            date: dayOffset(25),
          },
        ] as any)
        .select("id"),
    );

    const totalCreated = Object.values(created).reduce((a, b) => a + b, 0);
    const totalCleared = Object.values(cleared).reduce((a, b) => a + b, 0);
    return { ok: true, projectId, orgId, created, cleared, totalCreated, totalCleared };
  });
