"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PartListRow } from "@/components/parts/part-list-row";

export default function AssemblyDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const data = trpc.assemblies.byId.useQuery({ id });
  if (!data.data) {
    return (
      <div className="text-sm text-muted-foreground">Loading assembly…</div>
    );
  }
  const { assembly: a, parts } = data.data;
  const cots = parts.filter((p) => p.type === "cots");
  const custom = parts.filter((p) => p.type === "custom");

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/assemblies"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 w-fit"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All assemblies
      </Link>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            {a.name}
          </h1>
          <div className="text-sm text-muted-foreground font-mono">
            {a.onshapeDocumentId}
          </div>
        </div>
        {a.onshapeUrl && (
          <a
            href={a.onshapeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Onshape
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Custom parts
              <Badge variant="muted" className="font-mono">
                {custom.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {custom.map((p) => (
              <PartListRow key={p.id} part={p} />
            ))}
            {custom.length === 0 && (
              <div className="text-sm text-muted-foreground">None.</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              COTS parts
              <Badge variant="muted" className="font-mono">
                {cots.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {cots.map((p) => (
              <PartListRow key={p.id} part={p} />
            ))}
            {cots.length === 0 && (
              <div className="text-sm text-muted-foreground">None.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
