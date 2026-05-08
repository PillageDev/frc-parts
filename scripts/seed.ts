import { db } from "../src/lib/db/client";
import {
  machine,
  operation,
  part,
  routeTemplate,
  routeTemplateStep,
} from "../src/lib/db/schema";
import { sql, eq, asc, isNull } from "drizzle-orm";

const MACHINES = [
  {
    name: "Tormach 1100 P CNC",
    kind: "cnc_mill" as const,
    description: "Tormach 1100 P CNC mill — pulleys, brackets, complex pockets.",
    capacityNote: "1× job at a time",
    costPerHourCents: 6000,
  },
  {
    name: "Stepcraft CNC Router",
    kind: "cnc_router" as const,
    description: "Stepcraft 3-axis CNC router. Sheet aluminum, plastic, plate.",
    capacityNote: "1× job at a time",
    costPerHourCents: 4500,
  },
  {
    name: "Bridgeport Mill",
    kind: "manual_mill" as const,
    description:
      "Bridgeport manual mill — facing, drilling, tapping, finishing features.",
    capacityNote: "Shared bench mill",
    costPerHourCents: 2500,
  },
  {
    name: "Lathe",
    kind: "lathe" as const,
    description: "Lathe for shafts, standoffs, spacers.",
    capacityNote: "1× job at a time",
    costPerHourCents: 4000,
  },
  {
    name: "Boss Laser",
    kind: "laser_cutter" as const,
    description: "Boss laser cutter — Delrin, polycarbonate, acrylic.",
    capacityNote: "Up to 24×18 in stock",
    costPerHourCents: 3500,
  },
  {
    name: "Bandsaw",
    kind: "bandsaw" as const,
    description: "Manual bandsaw — stock prep, tube cutoff.",
    capacityNote: "Stock prep only",
    costPerHourCents: 1500,
  },
  {
    name: "Bambu X1C",
    kind: "3d_printer" as const,
    description: "Bambu X1C — PLA / PETG / ABS / Nylon.",
    capacityNote: "256×256×256 mm build volume",
    costPerHourCents: 800,
  },
  {
    name: "Bambu P1S — #1",
    kind: "3d_printer" as const,
    description: "Bambu P1S printer (bay 1).",
    capacityNote: "256×256×256 mm build volume",
    costPerHourCents: 600,
  },
  {
    name: "Bambu P1S — #2",
    kind: "3d_printer" as const,
    description: "Bambu P1S printer (bay 2).",
    capacityNote: "256×256×256 mm build volume",
    costPerHourCents: 600,
  },
  {
    name: "Bambu P1S — #3",
    kind: "3d_printer" as const,
    description: "Bambu P1S printer (bay 3).",
    capacityNote: "256×256×256 mm build volume",
    costPerHourCents: 600,
  },
  {
    name: "Bambu P1S — #4",
    kind: "3d_printer" as const,
    description: "Bambu P1S printer (bay 4).",
    capacityNote: "256×256×256 mm build volume",
    costPerHourCents: 600,
  },
  {
    name: "Manual / Bench",
    kind: "bench" as const,
    description:
      "Hand operations — tapping, deburring, sanding, support cleanup.",
    capacityNote: "No fixed capacity; whoever's at the bench picks it up.",
    costPerHourCents: 0,
  },
];

type TemplateSeed = {
  key: string;
  label: string;
  description: string;
  isAutoDetectable: boolean;
  sortOrder: number;
  steps: Array<{
    sequence: number;
    name: string;
    machineKind:
      | "cnc_router"
      | "cnc_mill"
      | "manual_mill"
      | "lathe"
      | "laser_cutter"
      | "3d_printer"
      | "bandsaw"
      | "bench"
      | "waterjet"
      | "outsource";
    estMinutes: number;
  }>;
};

const TEMPLATES: TemplateSeed[] = [
  {
    key: "tubing",
    label: "Tubing",
    description: "Box / square / rect tube — bandsaw cut to length only.",
    isAutoDetectable: true,
    sortOrder: 10,
    steps: [
      { sequence: 0, name: "Cut to length on Bandsaw", machineKind: "bandsaw", estMinutes: 10 },
      { sequence: 1, name: "Deburr cut ends (manual)", machineKind: "bench", estMinutes: 4 },
    ],
  },
  {
    key: "plate",
    label: "Plate / sheet",
    description: "Sheet aluminum / plate — Stepcraft router + manual finishing.",
    isAutoDetectable: true,
    sortOrder: 20,
    steps: [
      { sequence: 0, name: "CNC Router (sheet)", machineKind: "cnc_router", estMinutes: 20 },
      { sequence: 1, name: "Deburr Edges (manual)", machineKind: "bench", estMinutes: 8 },
      { sequence: 2, name: "Tap Mounting Holes (manual)", machineKind: "bench", estMinutes: 10 },
    ],
  },
  {
    key: "block",
    label: "Block / billet",
    description: "Solid stock — CNC mill on the Tormach, hand-finish.",
    isAutoDetectable: true,
    sortOrder: 30,
    steps: [
      { sequence: 0, name: "CNC Mill", machineKind: "cnc_mill", estMinutes: 30 },
      { sequence: 1, name: "Deburr & Tap (manual)", machineKind: "bench", estMinutes: 8 },
    ],
  },
  {
    key: "round",
    label: "Round / shaft",
    description: "Round stock turned on the lathe, finished on the Bridgeport.",
    isAutoDetectable: true,
    sortOrder: 40,
    steps: [
      { sequence: 0, name: "Turn on Lathe", machineKind: "lathe", estMinutes: 25 },
      { sequence: 1, name: "Cross-drill on Bridgeport", machineKind: "manual_mill", estMinutes: 8 },
      { sequence: 2, name: "Tap by Hand", machineKind: "bench", estMinutes: 5 },
    ],
  },
  {
    key: "print",
    label: "3D Print",
    description: "FDM printer — Bambu X1C / P1S.",
    isAutoDetectable: true,
    sortOrder: 50,
    steps: [
      { sequence: 0, name: "3D Print", machineKind: "3d_printer", estMinutes: 60 },
      { sequence: 1, name: "Deburr / Clean Supports (manual)", machineKind: "bench", estMinutes: 10 },
    ],
  },
  {
    key: "manual",
    label: "Manual fab",
    description: "Hand fabrication only.",
    isAutoDetectable: false,
    sortOrder: 60,
    steps: [
      { sequence: 0, name: "Manual Fabrication", machineKind: "bench", estMinutes: 30 },
    ],
  },
];

async function seedTemplates() {
  let inserted = 0;
  for (const t of TEMPLATES) {
    const existing = await db.query.routeTemplate.findFirst({
      where: eq(routeTemplate.key, t.key),
    });
    if (existing) continue;
    const [created] = await db
      .insert(routeTemplate)
      .values({
        key: t.key,
        label: t.label,
        description: t.description,
        isBuiltin: true,
        isAutoDetectable: t.isAutoDetectable,
        sortOrder: t.sortOrder,
      })
      .returning();
    for (const s of t.steps) {
      await db.insert(routeTemplateStep).values({
        templateId: created.id,
        sequence: s.sequence,
        name: s.name,
        machineKind: s.machineKind,
        estMinutes: s.estMinutes,
      });
    }
    inserted++;
  }
  console.log(`Seeded ${inserted} new route templates (${TEMPLATES.length - inserted} already present).`);
}

/**
 * Re-attach operations that were orphaned (machineId IS NULL) to whichever
 * machine matches the corresponding template step's `machineKind`. Used as
 * a one-shot backfill after a previous version of this seed wiped existing
 * machine assignments.
 */
async function relinkOrphanOperations() {
  const orphans = await db
    .select()
    .from(operation)
    .where(isNull(operation.machineId));
  if (orphans.length === 0) {
    console.log("No orphan operations to relink.");
    return;
  }

  const machines = await db.select().from(machine);
  let relinked = 0;
  for (const op of orphans) {
    const p = await db.query.part.findFirst({
      where: eq(part.id, op.partId),
    });
    if (!p) continue;
    const tmpl = await db.query.routeTemplate.findFirst({
      where: eq(routeTemplate.key, p.stockType),
    });
    if (!tmpl) continue;
    const steps = await db
      .select()
      .from(routeTemplateStep)
      .where(eq(routeTemplateStep.templateId, tmpl.id))
      .orderBy(asc(routeTemplateStep.sequence));
    const step = steps[op.sequence];
    if (!step) continue;
    const m =
      (step.machineId && machines.find((mc) => mc.id === step.machineId)) ||
      machines.find((mc) => mc.kind === step.machineKind);
    if (!m) continue;
    await db
      .update(operation)
      .set({ machineId: m.id })
      .where(eq(operation.id, op.id));
    relinked++;
  }
  console.log(
    `Re-linked ${relinked}/${orphans.length} orphan operations to machines.`,
  );
}

async function main() {
  // Idempotent: only insert machines that don't already exist (matched by
  // name). Never delete or wipe — that would orphan operations again.
  let inserted = 0;
  for (const m of MACHINES) {
    const existing = await db.query.machine.findFirst({
      where: eq(machine.name, m.name),
    });
    if (existing) continue;
    await db.insert(machine).values(m);
    inserted++;
  }
  console.log(
    `Inserted ${inserted} new machines (${MACHINES.length - inserted} already present).`,
  );

  await seedTemplates();
  await relinkOrphanOperations();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
