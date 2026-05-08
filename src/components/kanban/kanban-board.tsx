"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PART_STATUSES, type PartStatus } from "@/lib/db/schema";
import {
  priorityClass,
  priorityLabel,
  statusLabel,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

export function KanbanBoard() {
  const board = trpc.parts.kanban.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const utils = trpc.useUtils();
  const setStatus = trpc.parts.setStatus.useMutation({
    onMutate: async ({ id, status }) => {
      await utils.parts.kanban.cancel();
      const prev = utils.parts.kanban.getData();
      if (prev) {
        const next = prev.map((col) => ({
          status: col.status,
          parts: col.parts.filter((p) => p.id !== id),
        }));
        const moving = prev.flatMap((c) => c.parts).find((p) => p.id === id);
        if (moving) {
          const target = next.find((c) => c.status === status);
          if (target) target.parts = [{ ...moving, status }, ...target.parts];
        }
        utils.parts.kanban.setData(undefined, next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.parts.kanban.setData(undefined, ctx.prev);
    },
    onSettled: () => utils.parts.kanban.invalidate(),
  });

  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {PART_STATUSES.map((status) => {
        const col = board.data?.find((b) => b.status === status);
        const parts = col?.parts ?? [];
        return (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id) setStatus.mutate({ id, status });
              setDragId(null);
            }}
            className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2 min-h-[400px]"
          >
            <div className="flex items-center justify-between px-1.5 pt-1">
              <div className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
                {statusLabel[status]}
              </div>
              <Badge variant="muted" className="font-mono">
                {parts.length}
              </Badge>
            </div>
            <div className="flex flex-col gap-2">
              {parts.map((p) => (
                <Card
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", p.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(p.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className={cn(
                    "p-3 cursor-grab active:cursor-grabbing transition-shadow",
                    dragId === p.id && "opacity-50",
                    p.priority === "blocking" && "ring-1 ring-destructive/40",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={
                        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 " +
                        priorityClass(p.priority)
                      }
                    >
                      {priorityLabel[p.priority]}
                    </span>
                    {p.designChanged && (
                      <AlertTriangle className="h-3 w-3 text-amber-600" />
                    )}
                    {p.batchKey && (
                      <Badge
                        variant="accent"
                        className="text-[10px] py-0"
                      >
                        {p.batchKey}
                      </Badge>
                    )}
                  </div>
                  <Link
                    href={`/parts/${p.id}`}
                    className="font-medium text-sm leading-tight hover:underline"
                  >
                    {p.name}
                  </Link>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    {p.partNumber}{" "}
                    {p.material && (
                      <span className="not-italic"> · {p.material}</span>
                    )}
                  </div>
                </Card>
              ))}
              {parts.length === 0 && (
                <div className="text-[11px] text-muted-foreground/60 text-center py-6">
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KanbanLegend({ status }: { status: PartStatus }) {
  return statusLabel[status];
}
