"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  GitBranch,
  Hammer,
  PackageCheck,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc/client";
import { formatMinutes, timeAgo } from "@/lib/utils";
import { machineKindLabel } from "@/lib/labels";

export default function DashboardPage() {
  const summary = trpc.dashboard.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const machines = trpc.machines.list.useQuery();
  const status = trpc.parts.onshapeStatus.useQuery();

  const counts = summary.data?.counts;
  const total = Number(counts?.total ?? 0);
  const onRobot = Number(counts?.onRobot ?? 0);
  const inProd = Number(counts?.inProduction ?? 0);
  const ready = Number(counts?.ready ?? 0);
  const designChanged = Number(counts?.designChanged ?? 0);

  const completion = total > 0 ? Math.round((onRobot / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Manufacturing dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Live view of every part on the robot, where it sits in the queue,
            and what changed in CAD.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/kanban">
              <Hammer className="h-4 w-4" />
              Kanban Board
            </Link>
          </Button>
          <Button asChild>
            <Link href="/import">
              <GitBranch className="h-4 w-4" />
              Import from Onshape
            </Link>
          </Button>
        </div>
      </div>

      {!status.data?.connected && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="flex-row items-start gap-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="flex-1">
              <CardTitle className="text-base">
                Onshape not yet connected
              </CardTitle>
              <CardDescription className="mt-1">
                Add <code className="font-mono text-xs">ONSHAPE_ACCESS_KEY</code>{" "}
                and <code className="font-mono text-xs">ONSHAPE_SECRET_KEY</code>{" "}
                to <code className="font-mono text-xs">.env.local</code> and
                restart the dev server. Get keys at{" "}
                <a
                  href="https://dev-portal.onshape.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  dev-portal.onshape.com/keys
                </a>
                .
              </CardDescription>
            </div>
            <Button asChild variant="outline">
              <Link href="/import">Setup guide</Link>
            </Button>
          </CardHeader>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Parts tracked"
          value={total}
          icon={<Sparkles className="h-4 w-4" />}
          hint={`${counts?.custom ?? 0} custom · ${counts?.cots ?? 0} COTS`}
        />
        <KpiCard
          label="On the robot"
          value={onRobot}
          icon={<PackageCheck className="h-4 w-4" />}
          hint={`${completion}% of total complete`}
          progress={completion}
          accent
        />
        <KpiCard
          label="In production"
          value={inProd}
          icon={<Hammer className="h-4 w-4" />}
          hint={`${ready} more ready to start`}
        />
        <KpiCard
          label="Design changed"
          value={designChanged}
          icon={<AlertTriangle className="h-4 w-4" />}
          hint="Onshape microversion bumped"
          tone={designChanged > 0 ? "danger" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Machine load</CardTitle>
                <CardDescription>
                  Estimated remaining minutes per machine queue.
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/machines">
                  All machines
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {machines.data?.map(({ machine: m, queued, active, estPendingMinutes }) => {
              const total = Number(queued) + Number(active);
              const minutes = Number(estPendingMinutes);
              return (
                <Link
                  key={m.id}
                  href={`/machines/${m.id}`}
                  className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium leading-tight">{m.name}</div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {machineKindLabel[m.kind]}
                      </div>
                    </div>
                    <Badge
                      variant={total > 0 ? "default" : "muted"}
                      className="font-mono"
                    >
                      {total}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {minutes > 0 ? formatMinutes(minutes) : "Idle"}
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live design changes</CardTitle>
            <CardDescription>
              Microversion bumps detected on Onshape that may need
              re-manufacturing.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {summary.data?.recentChanges.length === 0 && (
              <div className="flex flex-col items-center text-center gap-2 py-6 text-muted-foreground text-sm">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                No changes since last sync.
              </div>
            )}
            {summary.data?.recentChanges.map(({ rev, part: p }) => (
              <Link
                key={rev.id}
                href={`/parts/${p.id}`}
                className="flex items-start gap-3 rounded-md border border-border p-3 hover:border-primary/50 transition-colors"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {p.name}{" "}
                    <span className="text-muted-foreground font-normal">
                      · {p.partNumber}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    {rev.changeSummary ?? "Microversion bumped"}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground/80 mt-1">
                    {rev.versionLabel} · {timeAgo(rev.createdAt)}
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  hint,
  progress,
  tone = "default",
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  hint: string;
  progress?: number;
  tone?: "default" | "danger";
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "ring-1 ring-primary/30" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription className="text-[11px] uppercase tracking-widest font-medium">
            {label}
          </CardDescription>
          <span
            className={
              tone === "danger"
                ? "text-destructive"
                : "text-muted-foreground"
            }
          >
            {icon}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className={
            "font-serif text-3xl tracking-tight " +
            (tone === "danger" && value > 0 ? "text-destructive" : "")
          }
        >
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
        {progress !== undefined && (
          <Progress value={progress} className="mt-3 h-1.5" />
        )}
      </CardContent>
    </Card>
  );
}
