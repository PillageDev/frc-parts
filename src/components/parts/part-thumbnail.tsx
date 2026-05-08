"use client";

import { Boxes } from "lucide-react";
import { cn } from "@/lib/utils";

export function PartThumbnail({
  url,
  alt,
  className,
}: {
  url: string | null | undefined;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40",
        className,
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      ) : (
        <Boxes className="h-8 w-8 text-muted-foreground/60" />
      )}
    </div>
  );
}
