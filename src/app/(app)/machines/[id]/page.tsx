"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Cpu,
  ExternalLink,
  FileDown,
  ListChecks,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  machineKindLabel,
  priorityClass,
  priorityLabel,
  stepStatusClass,
  stepStatusLabel,
} from "@/lib/labels";
import { STEP_STATUSES, type StepStatus } from "@/lib/db/schema";
import { formatMinutes, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

export default function MachinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const data = trpc.machines.byId.useQuery({ id }, { refetchInterval: 5_000 });
  const utils = trpc.useUtils();

  const setStatus = trpc.parts.setStepStatus.useMutation({
    onSuccess: () => {
      utils.machines.byId.invalidate();
      utils.machines.list.invalidate();
      utils.parts.list.invalidate();
      utils.parts.kanban.invalidate();
      utils.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!data.data) {
    return (
      <div className="text-sm text-muted-foreground">Loading machine…</div>
    );
  }
  const { machine: m, operations } = data.data;
  const inProgress = operations.filter((r) => r.op.status === "in_progress");
  const queued = operations.filter(
    (r) => r.op.status === "in_queue" || r.op.status === "not_started",
  );
  const onQc = operations.filter((r) => r.op.status === "qc_check");
  const done = operations.filter((r) => r.op.status === "complete");

  const nextUp = queued[0];

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/machines"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 w-fit"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All machines
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Cpu className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">
              {m.name}
            </h1>
            <div className="text-sm text-muted-foreground">
              {machineKindLabel[m.kind]}
              {m.description && <> · {m.description}</>}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {queued.length + inProgress.length === 0 ? "Idle" : "Active"}
              </span>
              <span>·</span>
              <span>
                {queued.length} queued · {inProgress.length} active ·{" "}
                {done.length} done
              </span>
            </div>
          </div>
        </div>
        {nextUp && inProgress.length === 0 && (
          <Button
            size="lg"
            onClick={() =>
              setStatus.mutate({
                stepId: nextUp.op.id,
                status: "in_progress",
              })
            }
            disabled={setStatus.isPending}
          >
            <PlayCircle className="h-4 w-4" />
            Pull next: {nextUp.part.name}
          </Button>
        )}
      </div>

      {inProgress.length > 0 && (
        <Card className="border-primary/40 ring-1 ring-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-primary" />
              Now running
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {inProgress.map(({ op, part }) => (
              <ActiveJob
                key={op.id}
                op={op}
                part={part}
                onComplete={() =>
                  setStatus.mutate({
                    stepId: op.id,
                    status: "complete",
                  })
                }
                onPause={() =>
                  setStatus.mutate({
                    stepId: op.id,
                    status: "in_queue",
                  })
                }
                onSendToQc={() =>
                  setStatus.mutate({
                    stepId: op.id,
                    status: "qc_check",
                  })
                }
                isPending={setStatus.isPending}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Column title="Up next" icon={<Clock className="h-3.5 w-3.5" />}>
          {queued.map(({ op, part }) => (
            <QueueCard
              key={op.id}
              op={op}
              part={part}
              actionIcon={<PlayCircle className="h-4 w-4" />}
              actionLabel="Start"
              onAction={() =>
                setStatus.mutate({
                  stepId: op.id,
                  status: "in_progress",
                })
              }
              actionPending={setStatus.isPending}
            />
          ))}
          {queued.length === 0 && <Empty>Nothing waiting.</Empty>}
        </Column>

        <Column
          title="QC"
          icon={<ListChecks className="h-3.5 w-3.5" />}
          tone="purple"
        >
          {onQc.map(({ op, part }) => (
            <QueueCard
              key={op.id}
              op={op}
              part={part}
              actionIcon={<Check className="h-4 w-4" />}
              actionLabel="Pass QC"
              onAction={() =>
                setStatus.mutate({
                  stepId: op.id,
                  status: "complete",
                })
              }
              actionPending={setStatus.isPending}
            />
          ))}
          {onQc.length === 0 && <Empty>No QC pending.</Empty>}
        </Column>

        <Column
          title="Done today"
          icon={<Check className="h-3.5 w-3.5" />}
          tone="emerald"
        >
          {done.slice(0, 12).map(({ op, part }) => (
            <Link
              key={op.id}
              href={`/parts/${part.id}`}
              className="rounded-md border border-border bg-card p-2.5 hover:border-primary/40 transition-colors block"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium truncate">
                  {part.name}
                </span>
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              </div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {part.partNumber} · {op.name}
              </div>
              {op.completedAt && (
                <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                  {timeAgo(op.completedAt)}
                  {op.actualMinutes != null && (
                    <> · {formatMinutes(op.actualMinutes)}</>
                  )}
                </div>
              )}
            </Link>
          ))}
          {done.length === 0 && <Empty>Nothing complete yet.</Empty>}
        </Column>
      </div>
    </div>
  );
}

function Column({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone?: "purple" | "emerald";
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <span
            className={
              tone === "purple"
                ? "text-purple-600 dark:text-purple-300"
                : tone === "emerald"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
            }
          >
            {icon}
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 flex-1">{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] text-muted-foreground/60 text-center py-3">
      {children}
    </div>
  );
}

type Op = {
  id: string;
  name: string;
  status: StepStatus;
  actualMinutes: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
};
type PartLite = {
  id: string;
  name: string;
  partNumber: string;
  priority: "blocking" | "high" | "normal" | "low";
  batchKey: string | null;
  thumbnailUrl: string | null;
  material: string | null;
};

function QueueCard({
  op,
  part,
  actionLabel,
  actionIcon,
  onAction,
  actionPending,
}: {
  op: Op;
  part: PartLite;
  actionLabel: string;
  actionIcon: React.ReactNode;
  onAction: () => void;
  actionPending: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className={
            "inline-flex rounded px-1 py-0.5 text-[10px] font-medium ring-1 " +
            priorityClass(part.priority)
          }
        >
          {priorityLabel[part.priority]}
        </span>
        {part.batchKey && (
          <Badge variant="accent" className="text-[10px] py-0">
            {part.batchKey}
          </Badge>
        )}
      </div>
      <div className="flex items-start gap-2">
        <Link
          href={`/parts/${part.id}`}
          className="font-medium text-sm leading-tight hover:underline flex-1 min-w-0 truncate"
        >
          {part.name}
        </Link>
      </div>
      <div className="text-[11px] text-muted-foreground font-mono truncate">
        {part.partNumber}
      </div>
      <div className="text-[11px] text-muted-foreground">{op.name}</div>
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          onClick={onAction}
          disabled={actionPending}
          className="flex-1"
        >
          {actionIcon}
          {actionLabel}
        </Button>
        <Link
          href={`/parts/${part.id}/run`}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          title="Open step-through view"
        >
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function ActiveJob({
  op,
  part,
  onComplete,
  onPause,
  onSendToQc,
  isPending,
}: {
  op: Op;
  part: PartLite;
  onComplete: () => void;
  onPause: () => void;
  onSendToQc: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex items-center gap-4 rounded-md bg-muted/40 border border-border p-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/parts/${part.id}`}
            className="font-medium hover:underline truncate"
          >
            {part.name}
          </Link>
          <code className="font-mono text-xs text-muted-foreground">
            {part.partNumber}
          </code>
          <span
            className={
              "inline-flex rounded px-1 py-0.5 text-[10px] font-medium ring-1 " +
              priorityClass(part.priority)
            }
          >
            {priorityLabel[part.priority]}
          </span>
          {part.batchKey && (
            <Badge variant="accent" className="text-[10px] py-0">
              {part.batchKey}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {op.name}
          {op.startedAt && (
            <span> · started {timeAgo(op.startedAt)}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button onClick={onComplete} disabled={isPending}>
          <Check className="h-4 w-4" />
          Complete
        </Button>
        <Button variant="outline" onClick={onSendToQc} disabled={isPending}>
          <ListChecks className="h-4 w-4" />
          QC
        </Button>
        <Button variant="outline" onClick={onPause} disabled={isPending}>
          <PauseCircle className="h-4 w-4" />
        </Button>
        <Link
          href={`/parts/${part.id}/run`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
