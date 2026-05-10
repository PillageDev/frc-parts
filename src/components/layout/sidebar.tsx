"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Cpu,
  GitBranch,
  Home,
  Kanban,
  Layers,
  PackageOpen,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/parts", label: "Parts", icon: PackageOpen },
  { href: "/kanban", label: "Kanban", icon: Kanban },
  { href: "/timeline", label: "Timeline", icon: Activity },
  { href: "/machines", label: "Machines", icon: Cpu },
  { href: "/templates", label: "Route Templates", icon: Layers },
  { href: "/import", label: "Onshape Import", icon: GitBranch },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
          <Wrench className="h-5 w-5" strokeWidth={2.4} />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-serif font-semibold text-base tracking-tight">
            SpikeParts
          </span>
          <span className="text-[11px] uppercase tracking-widest text-sidebar-foreground/60">
            Manufacturing OS
          </span>
        </div>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
