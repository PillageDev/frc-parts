import { asc, eq } from "drizzle-orm";
import type { db as DbInstance } from "@/lib/db/client";
import {
  routeTemplate,
  routeTemplateStep,
  type MachineKind,
  type StockType,
} from "@/lib/db/schema";

export type RoutingHint = {
  material: string | null | undefined;
  bboxX?: number | null;
  bboxY?: number | null;
  bboxZ?: number | null;
  isCots?: boolean;
  /** Optional explicit stock type — overrides auto-detection. */
  stockType?: StockType | null;
  /** Part name; used as a hint for auto-detection. */
  name?: string | null;
};

export type RoutedStep = {
  name: string;
  kind: MachineKind;
  /** Preferred machine from the template, if any. */
  machineId: string | null;
  estMinutes: number;
};

const matchesAny = (s: string | null | undefined, ...needles: string[]) => {
  if (!s) return false;
  const v = s.toLowerCase();
  return needles.some((n) => v.includes(n));
};

/**
 * Heuristic stock-type detection from material name, part name, and geometry.
 * Returns a built-in template key. User-defined templates are not
 * auto-detectable.
 */
export function detectStockType(part: RoutingHint): StockType {
  const m = part.material ?? "";
  const n = part.name ?? "";
  const both = (m + " " + n).toLowerCase();

  if (
    matchesAny(
      both,
      "tube",
      "tubing",
      "extrusion",
      "box tube",
      "rect tube",
      "punched",
    )
  )
    return "tubing";
  if (matchesAny(both, "rod", "shaft", "round bar", "round stock"))
    return "round";
  if (matchesAny(m, "pla", "abs", "petg", "tpu", "nylon")) return "print";

  const x = part.bboxX ?? 0;
  const y = part.bboxY ?? 0;
  const z = part.bboxZ ?? 0;
  const dims = [x, y, z].sort((a, b) => a - b);
  const thinnest = dims[0];
  const middle = dims[1];
  const longest = dims[2];
  const aspect = longest / Math.max(thinnest, 1);
  const crossAspect = middle / Math.max(thinnest, 1);

  if (thinnest > 0 && thinnest <= 8 && longest > 60) return "plate";

  if (longest > 40 && aspect > 4) {
    if (crossAspect > 1.25) return "tubing";
    if (matchesAny(m, "aluminum", "alum", "6061", "7075")) return "tubing";
    return "round";
  }

  return "block";
}

/**
 * Loads the route template's step list from the database. Returns an empty
 * array if no template matches the key (e.g. because the user deleted a
 * custom template that was still referenced by a part).
 */
export async function loadTemplateSteps(
  db: typeof DbInstance,
  templateKey: string,
): Promise<RoutedStep[]> {
  const tmpl = await db.query.routeTemplate.findFirst({
    where: eq(routeTemplate.key, templateKey),
  });
  if (!tmpl) return [];
  const steps = await db
    .select()
    .from(routeTemplateStep)
    .where(eq(routeTemplateStep.templateId, tmpl.id))
    .orderBy(asc(routeTemplateStep.sequence));
  return steps.map((s) => ({
    name: s.name,
    kind: s.machineKind,
    machineId: s.machineId,
    estMinutes: s.estMinutes,
  }));
}

/**
 * Estimates machining time independently of the routing using a simple
 * material-removal-rate heuristic. Returns minutes.
 */
export function estimateMinutes(
  kind: MachineKind,
  bbox: { x: number; y: number; z: number },
  material: string | null | undefined,
): number {
  const vol = bbox.x * bbox.y * bbox.z; // mm^3
  const isHard = matchesAny(material, "steel", "stainless", "7075");
  const factor = isHard ? 1.6 : 1;
  switch (kind) {
    case "cnc_router":
      return Math.round((25 + vol / 18000) * factor);
    case "cnc_mill":
      return Math.round((22 + vol / 12000) * factor);
    case "manual_mill":
      return Math.round((20 + vol / 14000) * factor);
    case "lathe":
      return Math.round((18 + Math.max(bbox.x, bbox.y, bbox.z) / 30) * factor);
    case "laser_cutter":
      return Math.round(6 + Math.max(bbox.x, bbox.y) / 120);
    case "3d_printer":
      return Math.round(45 + vol / 8000);
    case "bandsaw":
      return Math.round(Math.max(8, Math.max(bbox.x, bbox.y, bbox.z) / 80));
    case "chopsaw":
      return Math.round(Math.max(5, Math.max(bbox.x, bbox.y, bbox.z) / 100));
    case "bench":
      return 8;
    case "waterjet":
      return Math.round((12 + Math.max(bbox.x, bbox.y) / 80) * factor);
    case "outsource":
      return 60 * 24 * 3;
  }
}
