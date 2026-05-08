import type { MachineKind, PartStatus, Priority, StepStatus, StockType } from "@/lib/db/schema";

export const machineKindLabel: Record<MachineKind, string> = {
  cnc_router: "CNC Router",
  cnc_mill: "CNC Mill",
  manual_mill: "Manual Mill",
  lathe: "Lathe",
  laser_cutter: "Laser Cutter",
  "3d_printer": "3D Printer",
  bandsaw: "Bandsaw",
  chopsaw: "Chopsaw",
  bench: "Manual / Bench",
  waterjet: "Waterjet",
  outsource: "Outsource",
};

export const statusLabel: Record<PartStatus, string> = {
  ready_to_make: "Ready to Make",
  in_production: "In Production",
  qc: "QC Check",
  done: "Done",
  on_robot: "On Robot",
};

export const stepStatusLabel: Record<StepStatus, string> = {
  not_started: "Not Started",
  in_queue: "In Queue",
  in_progress: "In Progress",
  qc_check: "QC Check",
  complete: "Complete",
};

export const priorityLabel: Record<Priority, string> = {
  blocking: "Blocking",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const stockTypeLabel: Record<StockType, string> = {
  auto: "Auto",
  tubing: "Tubing",
  plate: "Plate",
  block: "Block",
  round: "Round",
  print: "3D Print",
  manual: "Manual",
};

export function stockTypeBadgeVariant(s: StockType) {
  switch (s) {
    case "tubing":
      return "accent" as const;
    case "plate":
      return "secondary" as const;
    case "round":
      return "default" as const;
    case "print":
      return "muted" as const;
    case "manual":
      return "warning" as const;
    case "block":
      return "muted" as const;
    case "auto":
      return "muted" as const;
  }
}

export function priorityClass(p: Priority): string {
  switch (p) {
    case "blocking":
      return "bg-destructive/15 text-destructive ring-destructive/30";
    case "high":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30";
    case "normal":
      return "bg-muted text-muted-foreground ring-border";
    case "low":
      return "bg-muted/60 text-muted-foreground/80 ring-border";
  }
}

export function statusClass(s: PartStatus): string {
  switch (s) {
    case "ready_to_make":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "in_production":
      return "bg-amber-500/20 text-amber-800 dark:text-amber-200";
    case "qc":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-300";
    case "done":
      return "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200";
    case "on_robot":
      return "bg-primary/20 text-foreground ring-primary/50";
  }
}

export function stepStatusClass(s: StepStatus): string {
  switch (s) {
    case "not_started":
      return "bg-muted text-muted-foreground";
    case "in_queue":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "in_progress":
      return "bg-amber-500/20 text-amber-800 dark:text-amber-200";
    case "qc_check":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-300";
    case "complete":
      return "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200";
  }
}
