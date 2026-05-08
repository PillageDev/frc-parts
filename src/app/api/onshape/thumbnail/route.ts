import { NextRequest } from "next/server";
import { onshape, OnshapeAuthError } from "@/lib/onshape/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const documentId = url.searchParams.get("d");
  const workspaceId = url.searchParams.get("w") ?? undefined;
  const versionId = url.searchParams.get("v") ?? undefined;
  const elementId = url.searchParams.get("e");
  const partId = url.searchParams.get("p") ?? undefined;
  const size = (url.searchParams.get("s") ?? "300x300") as
    | "70x40"
    | "300x300"
    | "600x340";

  if (!documentId || !elementId || (!workspaceId && !versionId)) {
    return new Response("Missing d/e and one of w/v", { status: 400 });
  }
  try {
    const upstream = partId
      ? await onshape.partThumbnail({
          documentId,
          workspaceId,
          versionId,
          elementId,
          partId,
          size,
        })
      : await onshape.elementThumbnail({
          documentId,
          workspaceId,
          versionId,
          elementId,
          size,
        });
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    if (err instanceof OnshapeAuthError) {
      return new Response(err.message, { status: 401 });
    }
    return new Response((err as Error).message, { status: 502 });
  }
}
