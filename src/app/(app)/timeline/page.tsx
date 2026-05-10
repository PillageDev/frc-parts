"use client";

import Link from "next/link";
import { Activity, ArrowRight, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  priorityClass,
  priorityLabel,
  statusClass,
  statusLabel,
  stepStatusClass,
  stepStatusLabel,
} from "@/lib/labels";
import { formatMinutes, timeAgo } from "@/lib/utils";
import type { StepStatus } from "@/lib/db/schema";

const ROW_HEIGHT = 36;
const BAR_HEIGHT = 16;
const HEADER_HEIGHT = 28;
const LEFT_GUTTER = 240;
const PADDING_X = 12;

export default function TimelinePage() {
  const data = trpc.parts.timeline.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          Timeline
        </h1>
        <p className="text-muted-foreground mt-1">
          Live Gantt-style view of every open workflow plus parts that have
          actually started moving. Hover any segment for the operation
          details.
        </p>
      </div>

      {data.isLoading && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      )}

      {data.data && data.data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center text-center gap-2 py-10">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-serif text-lg">Nothing in flight</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Once you start manufacturing a part, its run history shows up
              here as a horizontal bar.
            </p>
          </CardContent>
        </Card>
      )}

      {data.data && data.data.length > 0 && (
        <Chart parts={data.data} />
      )}
    </div>
  );
}

type Op = {
  id: string;
  name: string;
  status: StepStatus;
  machineName: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  actualMinutes: number | null;
};
type Row = {
  id: string;
  name: string;
  partNumber: string;
  status: "ready_to_make" | "in_production" | "qc" | "done" | "on_robot";
  priority: "blocking" | "high" | "normal" | "low";
  batchKey: string | null;
  createdAt: Date;
  firstStartedAt: Date | null;
  lastCompletedAt: Date | null;
  operations: Op[];
};

function Chart({ parts }: { parts: Row[] }) {
  const now = Date.now();
  // Domain: from earliest started timestamp (or 7 days ago if none) → now.
  const earliestStart = Math.min(
    ...parts.flatMap((p) =>
      p.operations
        .map((o) => (o.startedAt ? new Date(o.startedAt).getTime() : Infinity))
        .filter((n) => Number.isFinite(n)),
    ),
  );
  const t0 = Number.isFinite(earliestStart)
    ? earliestStart - 60 * 60 * 1000 // pad 1h before
    : now - 7 * 24 * 60 * 60 * 1000;
  const t1 = now;
  const span = Math.max(60_000, t1 - t0);

  // Sort: in-flight first (running > queued > qc > ready), then done by latest
  // completion descending.
  const orderedParts = [...parts].sort((a, b) => {
    const order = (s: Row["status"]) =>
      s === "in_production"
        ? 0
        : s === "qc"
          ? 1
          : s === "ready_to_make"
            ? 2
            : s === "done"
              ? 3
              : 4;
    if (order(a.status) !== order(b.status)) return order(a.status) - order(b.status);
    const aTime = a.lastCompletedAt
      ? new Date(a.lastCompletedAt).getTime()
      : a.firstStartedAt
        ? new Date(a.firstStartedAt).getTime()
        : 0;
    const bTime = b.lastCompletedAt
      ? new Date(b.lastCompletedAt).getTime()
      : b.firstStartedAt
        ? new Date(b.firstStartedAt).getTime()
        : 0;
    return bTime - aTime;
  });

  const ticks = generateTicks(t0, t1);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {orderedParts.length} part{orderedParts.length === 1 ? "" : "s"} in
          flight
        </CardTitle>
        <CardDescription>
          Each row is one part. Each colored segment is one operation; bar
          length is real elapsed time.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="relative overflow-x-auto">
          <div
            className="relative"
            style={{
              minWidth: 900,
              minHeight:
                HEADER_HEIGHT + ROW_HEIGHT * orderedParts.length + 24,
            }}
          >
            {/* Time axis header */}
            <div
              className="sticky top-0 z-10 bg-card border-b border-border"
              style={{
                height: HEADER_HEIGHT,
                paddingLeft: LEFT_GUTTER,
              }}
            >
              <div
                className="relative h-full"
                style={{ paddingRight: PADDING_X }}
              >
                {ticks.map((t) => {
                  const pct = ((t.value - t0) / span) * 100;
                  return (
                    <div
                      key={t.value}
                      className="absolute top-0 h-full text-[10px] uppercase tracking-widest text-muted-foreground"
                      style={{ left: `calc(${pct}% + ${PADDING_X / 2}px)` }}
                    >
                      <div className="border-l border-border h-full pl-1">
                        {t.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* "Now" reference line */}
            <div
              className="absolute top-0 bottom-0 z-0 border-r border-primary/40"
              style={{
                left: `calc(${LEFT_GUTTER}px + ((${now - t0} / ${span}) * (100% - ${LEFT_GUTTER + PADDING_X}px)) + ${PADDING_X / 2}px)`,
              }}
            >
              <div className="absolute top-1 -translate-x-1/2 text-[9px] uppercase tracking-widest text-primary bg-card px-1">
                now
              </div>
            </div>

            {/* Rows */}
            {orderedParts.map((p, i) => (
              <PartRow
                key={p.id}
                part={p}
                t0={t0}
                t1={t1}
                top={HEADER_HEIGHT + i * ROW_HEIGHT}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PartRow({
  part: p,
  t0,
  t1,
  top,
}: {
  part: Row;
  t0: number;
  t1: number;
  top: number;
}) {
  const span = t1 - t0;
  return (
    <div
      className="absolute left-0 right-0 group hover:bg-muted/30"
      style={{ top, height: ROW_HEIGHT }}
    >
      {/* Left gutter — part info */}
      <Link
        href={`/parts/${p.id}`}
        className="absolute left-0 top-0 bottom-0 flex items-center gap-2 px-3 border-b border-border/60 group-hover:bg-muted/40 transition-colors"
        style={{ width: LEFT_GUTTER }}
      >
        <span
          className={
            "inline-flex rounded px-1 py-0.5 text-[9px] font-medium ring-1 " +
            priorityClass(p.priority)
          }
        >
          {priorityLabel[p.priority][0]}
        </span>
        <span className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{p.name}</div>
          <div className="text-[10px] font-mono text-muted-foreground truncate">
            {p.partNumber}
          </div>
        </span>
        <span
          className={
            "inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium " +
            statusClass(p.status)
          }
        >
          {statusLabel[p.status]}
        </span>
      </Link>

      {/* Bar area */}
      <div
        className="absolute top-0 bottom-0 right-0 border-b border-border/60"
        style={{ left: LEFT_GUTTER, paddingLeft: PADDING_X / 2, paddingRight: PADDING_X / 2 }}
      >
        <div
          className="relative h-full"
          style={{ height: ROW_HEIGHT }}
        >
          {p.operations.map((op, i) => {
            const start = op.startedAt
              ? new Date(op.startedAt).getTime()
              : null;
            const end =
              op.completedAt != null
                ? new Date(op.completedAt).getTime()
                : op.status === "in_progress" && start != null
                  ? Date.now()
                  : null;
            if (start == null) return null;
            const finalEnd = end ?? Date.now();
            const left = ((start - t0) / span) * 100;
            const width = Math.max(
              0.4,
              ((finalEnd - start) / span) * 100,
            );
            return (
              <div
                key={op.id}
                title={`${op.name}${op.machineName ? ` · ${op.machineName}` : ""} · ${stepStatusLabel[op.status]}${op.actualMinutes != null ? ` · ${formatMinutes(op.actualMinutes)}` : ""}`}
                className={
                  "absolute rounded-sm border " +
                  segmentClass(op.status)
                }
                style={{
                  top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
                  height: BAR_HEIGHT,
                  left: `${left}%`,
                  width: `${width}%`,
                  zIndex: 1 + i,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function segmentClass(status: StepStatus) {
  switch (status) {
    case "complete":
      return "bg-emerald-500/40 border-emerald-500/70";
    case "in_progress":
      return "bg-primary/50 border-primary/80 animate-pulse";
    case "qc_check":
      return "bg-purple-500/40 border-purple-500/70";
    case "in_queue":
      return "bg-blue-500/30 border-blue-500/60";
    case "not_started":
      return "bg-muted border-border";
  }
}

/** Generate a few well-spaced tick labels across [t0, t1]. */
function generateTicks(t0: number, t1: number) {
  const span = t1 - t0;
  const targetTicks = 8;
  const step = span / targetTicks;
  const out: { value: number; label: string }[] = [];
  for (let i = 0; i <= targetTicks; i++) {
    const t = t0 + step * i;
    out.push({ value: t, label: shortDate(new Date(t), span) });
  }
  return out;
}

function shortDate(d: Date, spanMs: number) {
  if (spanMs < 36 * 60 * 60 * 1000) {
    // < 36h → show time
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  // longer span → show date
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
