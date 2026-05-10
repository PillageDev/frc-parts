"use client";

import { Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth/client";

export function Topbar() {
  const { data: session } = useSession();
  const status = trpc.parts.onshapeStatus.useQuery(undefined, {
    refetchOnMount: false,
  });

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
