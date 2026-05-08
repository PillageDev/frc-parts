"use client";

import Link from "next/link";
import { Boxes, GitBranch } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function AssembliesPage() {
  const list = trpc.assemblies.list.useQuery();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Assemblies
          </h1>
          <p className="text-muted-foreground mt-1">
            Top-level assemblies pulled from Onshape, with a flattened parts
            list and COTS / custom split.
          </p>
        </div>
        <Button asChild>
          <Link href="/import">
            <GitBranch className="h-4 w-4" />
            Import assembly
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.data?.map(({ assembly: a, partCount, cotsCount, customCount }) => (
          <Link key={a.id} href={`/assemblies/${a.id}`} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <Boxes className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base">{a.name}</CardTitle>
                </div>
                <CardDescription className="text-xs font-mono break-all">
                  {a.onshapeDocumentId}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-2 flex-wrap">
                <Badge variant="muted">{Number(partCount)} parts</Badge>
                <Badge variant="default">
                  {Number(customCount)} custom
                </Badge>
                <Badge variant="secondary">{Number(cotsCount)} COTS</Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
        {list.data?.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="flex flex-col items-center text-center gap-3 py-10">
              <p className="text-sm text-muted-foreground max-w-md">
                No assemblies yet. Import an Onshape assembly to flatten its
                parts list, distinguish COTS from custom, and auto-route every
                custom part.
              </p>
              <Button asChild>
                <Link href="/import">Import from Onshape</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
