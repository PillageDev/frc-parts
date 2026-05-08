"use client";

import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSession } from "@/lib/auth/client";
import { timeAgo } from "@/lib/utils";

export function Topbar() {
  const { data: session } = useSession();
  const status = trpc.parts.onshapeStatus.useQuery(undefined, {
    refetchOnMount: false,
  });
  const summary = trpc.dashboard.summary.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const designChanges = Number(summary.data?.counts?.designChanged ?? 0);
  const recentChanges = summary.data?.recentChanges ?? [];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-5 backdrop-blur">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative hidden md:block w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search parts, assemblies, jobs…"
            className="pl-8 h-9 bg-card"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          variant={status.data?.connected ? "success" : "warning"}
          className="hidden sm:inline-flex"
        >
          {status.data?.connected ? "Onshape connected" : "Onshape: not configured"}
        </Badge>

        <Popover>
          <PopoverTrigger asChild>
            <button
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {designChanges > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {designChanges}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Design changes
              </div>
              {designChanges > 0 && (
                <Link
                  href="/parts?designChanged=1"
                  className="text-xs text-primary hover:underline"
                >
                  View all
                </Link>
              )}
            </div>
            <div className="max-h-[360px] overflow-y-auto py-1">
              {recentChanges.length === 0 ? (
                <div className="flex flex-col items-center text-center gap-2 py-6 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  No design changes to review.
                </div>
              ) : (
                recentChanges.map(({ rev, part: p }) => (
                  <Link
                    key={rev.id}
                    href={`/parts/${p.id}`}
                    className="flex items-start gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors"
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {p.name}{" "}
                        <span className="text-muted-foreground font-mono text-[11px]">
                          · {p.partNumber}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {rev.changeSummary ?? "Microversion bumped in Onshape"}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground/80 mt-0.5">
                        {rev.versionLabel} · {timeAgo(rev.createdAt)}
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Avatar className="h-9 w-9 border border-border">
          <AvatarFallback className="font-medium">
            {(session?.user?.name ?? "S P")
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
