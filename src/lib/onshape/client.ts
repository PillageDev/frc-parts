/**
 * Onshape REST API client (HMAC-signed).
 *
 * Setup
 * ─────
 *   1. Visit https://dev-portal.onshape.com → "API Keys" → "Create new API key".
 *   2. Pick the scopes you need; for SpikeParts the minimum is:
 *        - OAuth2Read   (read documents, elements, parts)
 *        - OAuth2ReadPII (only if you want owner names)
 *      For thumbnails you also need read access to the document.
 *   3. Copy the access key + secret. They are shown ONCE — save them.
 *   4. Put them in `.env.local` (or `.env`):
 *        ONSHAPE_ACCESS_KEY=...
 *        ONSHAPE_SECRET_KEY=...
 *        # optional, defaults to https://cad.onshape.com
 *        # ONSHAPE_BASE_URL=https://cad.onshape.com
 *   5. Restart `pnpm dev` so Next picks up the env vars.
 *
 * The API key authorizes calls AS YOU. Anything you can see in the Onshape UI
 * the app can read. Make sure the documents you want to import are either
 * yours or shared with the account that owns the API key.
 *
 * Signing
 * ───────
 * Per https://onshape-public.github.io/docs/auth/apikeys/, every request must
 * include `Date`, `On-Nonce`, and an `Authorization` header of the form
 *   On <ACCESS_KEY>:HmacSHA256:<base64(HMAC_SHA256(secret, stringToSign))>
 * where stringToSign = method\nnonce\ndate\ncontentType\npath\nquery\n
 * (all lowercase). Query params must be URL-encoded and sorted by key.
 */

import { createHmac, randomBytes } from "node:crypto";

const BASE_URL = process.env.ONSHAPE_BASE_URL ?? "https://cad.onshape.com";

export class OnshapeAuthError extends Error {
  constructor(
    message = "Onshape API credentials are not configured. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY in .env.local.",
  ) {
    super(message);
    this.name = "OnshapeAuthError";
  }
}

export class OnshapeApiError extends Error {
  constructor(
    public status: number,
    public method: string,
    public path: string,
    public body: string,
  ) {
    super(`Onshape ${method} ${path} → ${status}: ${body.slice(0, 240)}`);
    this.name = "OnshapeApiError";
  }
}

export function hasOnshapeCredentials() {
  return Boolean(
    process.env.ONSHAPE_ACCESS_KEY && process.env.ONSHAPE_SECRET_KEY,
  );
}

function getCreds() {
  const accessKey = process.env.ONSHAPE_ACCESS_KEY;
  const secretKey = process.env.ONSHAPE_SECRET_KEY;
  if (!accessKey || !secretKey) throw new OnshapeAuthError();
  return { accessKey, secretKey };
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildQueryString(query: Query | undefined) {
  if (!query) return "";
  const entries = Object.entries(query).filter(
    ([, v]) => v !== undefined && v !== null,
  );
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join("&");
}

function signRequest(opts: {
  method: string;
  path: string;
  query?: Query;
  contentType?: string;
}) {
  const { accessKey, secretKey } = getCreds();
  const date = new Date().toUTCString();
  const nonce = randomBytes(20).toString("hex").slice(0, 25);
  const contentType = opts.contentType ?? "application/json";
  const queryString = buildQueryString(opts.query);

  const stringToSign = [
    opts.method.toLowerCase(),
    nonce.toLowerCase(),
    date.toLowerCase(),
    contentType.toLowerCase(),
    opts.path.toLowerCase(),
    queryString.toLowerCase(),
    "",
  ].join("\n");

  const signature = createHmac("sha256", secretKey)
    .update(stringToSign)
    .digest("base64");

  const url =
    BASE_URL + opts.path + (queryString ? `?${queryString}` : "");

  const headers: Record<string, string> = {
    "On-Nonce": nonce,
    Date: date,
    "Content-Type": contentType,
    Accept:
      "application/json;charset=UTF-8;qs=0.09, application/vnd.onshape.v1+json",
    Authorization: `On ${accessKey}:HmacSHA256:${signature}`,
  };

  return { url, headers };
}

async function onshapeFetch<T>(opts: {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Query;
}): Promise<T> {
  const method = opts.method ?? "GET";
  const { url, headers } = signRequest({
    method,
    path: opts.path,
    query: opts.query,
  });
  const res = await fetch(url, { method, headers });
  if (!res.ok) {
    throw new OnshapeApiError(res.status, method, opts.path, await res.text());
  }
  return (await res.json()) as T;
}

async function onshapeFetchRaw(opts: {
  method?: "GET";
  path: string;
  query?: Query;
  accept?: string;
}): Promise<Response> {
  const method = opts.method ?? "GET";
  const { url, headers } = signRequest({
    method,
    path: opts.path,
    query: opts.query,
  });
  // The Accept header isn't part of Onshape's HMAC string-to-sign, so we can
  // override it post-signing without breaking auth. Image endpoints will
  // reject the JSON Accept default with 406.
  if (opts.accept) headers.Accept = opts.accept;
  const res = await fetch(url, { method, headers, redirect: "follow" });
  if (!res.ok) {
    throw new OnshapeApiError(res.status, method, opts.path, await res.text());
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Onshape entity URL parsing
// ─────────────────────────────────────────────────────────────────────────────

export type OnshapeRef = {
  documentId: string;
  workspaceId?: string;
  versionId?: string;
  elementId?: string;
};

/**
 * Parses links of the form
 *   https://cad.onshape.com/documents/{did}/w/{wid}/e/{eid}
 *   https://cad.onshape.com/documents/{did}/v/{vid}/e/{eid}
 *   https://cad.onshape.com/documents/{did}/w/{wid}
 *   https://cad.onshape.com/documents/{did}
 */
export function parseOnshapeUrl(url: string): OnshapeRef {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const docIdx = parts.indexOf("documents");
  if (docIdx === -1) throw new Error("Not an Onshape document URL");
  const documentId = parts[docIdx + 1];
  const ref: OnshapeRef = { documentId };
  for (let i = docIdx + 2; i < parts.length; i += 2) {
    const tag = parts[i];
    const id = parts[i + 1];
    if (tag === "w") ref.workspaceId = id;
    else if (tag === "v") ref.versionId = id;
    else if (tag === "e") ref.elementId = id;
  }
  return ref;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed responses (subset — Onshape returns much more)
// ─────────────────────────────────────────────────────────────────────────────

export type OnshapeDocument = {
  id: string;
  name: string;
  href: string;
  defaultWorkspace: { id: string; name: string };
  modifiedAt?: string;
  thumbnail?: { href: string };
};

export type OnshapeElement = {
  id: string;
  name: string;
  elementType: "PARTSTUDIO" | "ASSEMBLY" | "DRAWING" | "BLOB" | string;
  microversionId?: string;
};

export type OnshapePart = {
  partId: string;
  name: string;
  partNumber?: string;
  material?: { name?: string; displayName?: string } | null;
  appearance?: unknown;
  bodyType?: string;
  state?: string;
  elementId?: string;
};

export type MassProperties = {
  bodies: Record<
    string,
    {
      mass: [number, number, number]; // value + min/max bounds
      volume: [number, number, number];
      centroid?: number[];
      principalInertia?: number[];
    }
  >;
};

export type BoundingBox = {
  lowX: number;
  lowY: number;
  lowZ: number;
  highX: number;
  highY: number;
  highZ: number;
};

export type OnshapeInstance = {
  id: string;
  name: string;
  type: "Part" | "Assembly";
  partId?: string;
  documentId?: string;
  elementId?: string;
  versionId?: string;
  documentMicroversion?: string;
  isStandardContent?: boolean;
  configuration?: string;
};

export type AssemblyDefinition = {
  rootAssembly: {
    instances: OnshapeInstance[];
    documentId?: string;
    elementId?: string;
  };
  /** Sub-assembly definitions referenced by Assembly instances. */
  subAssemblies?: Array<{
    documentId: string;
    elementId: string;
    instances: OnshapeInstance[];
  }>;
  parts?: OnshapePart[];
};

/**
 * Walks the rootAssembly + subAssemblies graph and yields every leaf Part
 * instance (recursing through sub-assemblies). Matches sub-assemblies by
 * (documentId, elementId).
 */
export function flattenAssemblyParts(def: AssemblyDefinition): OnshapeInstance[] {
  const subMap = new Map<string, OnshapeInstance[]>();
  for (const sa of def.subAssemblies ?? []) {
    subMap.set(`${sa.documentId}:${sa.elementId}`, sa.instances);
  }
  const out: OnshapeInstance[] = [];
  const seen = new Set<string>();

  function walk(instances: OnshapeInstance[]) {
    for (const inst of instances) {
      if (inst.type === "Part" && inst.partId) {
        out.push(inst);
      } else if (inst.type === "Assembly" && inst.documentId && inst.elementId) {
        const key = `${inst.documentId}:${inst.elementId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sub = subMap.get(key);
        if (sub) walk(sub);
      }
    }
  }
  walk(def.rootAssembly.instances);
  return out;
}

export type DocumentMicroversion = {
  microversion: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Higher-level helpers
// ─────────────────────────────────────────────────────────────────────────────

export const onshape = {
  hasCredentials: hasOnshapeCredentials,

  async listDocuments(opts?: { q?: string; limit?: number }) {
    const data = await onshapeFetch<{ items: OnshapeDocument[] }>({
      path: "/api/v6/documents",
      query: { q: opts?.q, limit: opts?.limit ?? 20 },
    });
    return data.items;
  },

  async getDocument(documentId: string) {
    return onshapeFetch<OnshapeDocument>({
      path: `/api/v6/documents/${documentId}`,
    });
  },

  async listElements(ref: OnshapeRef) {
    const wOrV = ref.workspaceId
      ? `w/${ref.workspaceId}`
      : `v/${ref.versionId}`;
    return onshapeFetch<OnshapeElement[]>({
      path: `/api/v6/documents/d/${ref.documentId}/${wOrV}/elements`,
    });
  },

  async listParts(ref: Required<Pick<OnshapeRef, "documentId" | "elementId">> & {
    workspaceId?: string;
    versionId?: string;
  }) {
    const wOrV = ref.workspaceId
      ? `w/${ref.workspaceId}`
      : `v/${ref.versionId}`;
    return onshapeFetch<OnshapePart[]>({
      path: `/api/v6/parts/d/${ref.documentId}/${wOrV}/e/${ref.elementId}`,
    });
  },

  async partMassProperties(opts: {
    documentId: string;
    workspaceId?: string;
    versionId?: string;
    elementId: string;
    partId: string;
  }) {
    const wOrV = opts.workspaceId
      ? `w/${opts.workspaceId}`
      : `v/${opts.versionId}`;
    return onshapeFetch<MassProperties>({
      path: `/api/v6/parts/d/${opts.documentId}/${wOrV}/e/${opts.elementId}/partid/${encodeURIComponent(opts.partId)}/massproperties`,
    });
  },

  async partBoundingBox(opts: {
    documentId: string;
    workspaceId?: string;
    versionId?: string;
    elementId: string;
    partId: string;
  }) {
    const wOrV = opts.workspaceId
      ? `w/${opts.workspaceId}`
      : `v/${opts.versionId}`;
    return onshapeFetch<BoundingBox>({
      path: `/api/v6/parts/d/${opts.documentId}/${wOrV}/e/${opts.elementId}/partid/${encodeURIComponent(opts.partId)}/boundingboxes`,
    });
  },

  async partMetadata(opts: {
    documentId: string;
    workspaceId?: string;
    versionId?: string;
    elementId: string;
    partId: string;
  }) {
    const wOrV = opts.workspaceId
      ? `w/${opts.workspaceId}`
      : `v/${opts.versionId}`;
    return onshapeFetch<{
      properties?: Array<{ name: string; value: unknown }>;
    }>({
      path: `/api/v6/metadata/d/${opts.documentId}/${wOrV}/e/${opts.elementId}/p/${encodeURIComponent(opts.partId)}`,
    });
  },

  async assembly(ref: Required<Pick<OnshapeRef, "documentId" | "elementId">> & {
    workspaceId?: string;
    versionId?: string;
  }) {
    const wOrV = ref.workspaceId
      ? `w/${ref.workspaceId}`
      : `v/${ref.versionId}`;
    return onshapeFetch<AssemblyDefinition>({
      path: `/api/v6/assemblies/d/${ref.documentId}/${wOrV}/e/${ref.elementId}`,
      query: { includePartProperties: true },
    });
  },

  async currentMicroversion(ref: { documentId: string; workspaceId: string }) {
    return onshapeFetch<DocumentMicroversion>({
      path: `/api/v6/documents/d/${ref.documentId}/w/${ref.workspaceId}/currentmicroversion`,
    });
  },

  /** Returns a streamable Response. Use to proxy thumbnails. */
  async elementThumbnail(opts: {
    documentId: string;
    workspaceId?: string;
    versionId?: string;
    elementId: string;
    size?: "70x40" | "300x300" | "600x340";
  }) {
    const wOrV = opts.workspaceId
      ? `w/${opts.workspaceId}`
      : `v/${opts.versionId}`;
    return onshapeFetchRaw({
      path: `/api/v6/thumbnails/d/${opts.documentId}/${wOrV}/e/${opts.elementId}/s/${opts.size ?? "300x300"}`,
      accept: "image/png,image/jpeg,image/svg+xml,image/*;q=0.9,*/*;q=0.5",
    });
  },

  /**
   * Per-part thumbnail. Renders just the chosen part instead of the whole
   * Part Studio. Tries Onshape's documented part-thumbnail endpoint first,
   * falls back to the part metadata's thumbnailInfo.href, then to the
   * element-level thumbnail as a last resort. Each Onshape `thumbnailInfo`
   * entry is itself a signed Onshape URL, so we always go through our
   * signed-fetch helper rather than `fetch()`-ing the href directly.
   */
  async partThumbnail(opts: {
    documentId: string;
    workspaceId?: string;
    versionId?: string;
    elementId: string;
    partId: string;
    size?: "70x40" | "300x300" | "600x340";
  }) {
    const wOrV = opts.workspaceId
      ? `w/${opts.workspaceId}`
      : `v/${opts.versionId}`;
    const size = opts.size ?? "300x300";
    const accept =
      "image/png,image/jpeg,image/svg+xml,image/*;q=0.9,*/*;q=0.5";
    const partid = encodeURIComponent(opts.partId);

    // Onshape exposes per-part thumbnails under /thumbnails/.../e/{eid}/p/{partid}/s/{size}.
    // Some accounts also accept /parts/.../partid/{partid}/thumbnails/{size}.
    // Try both before degrading to the element-level render.
    const paths = [
      `/api/v6/thumbnails/d/${opts.documentId}/${wOrV}/e/${opts.elementId}/p/${partid}/s/${size}`,
      `/api/v6/parts/d/${opts.documentId}/${wOrV}/e/${opts.elementId}/partid/${partid}/thumbnails/${size}`,
    ];

    let lastErr: unknown;
    for (const path of paths) {
      try {
        return await onshapeFetchRaw({ path, accept });
      } catch (err) {
        lastErr = err;
        if (err instanceof OnshapeApiError && (err.status === 404 || err.status === 400)) {
          continue;
        }
        throw err;
      }
    }

    // Last resort: ask the part for its thumbnailInfo and fetch whichever
    // size matches. The hrefs are signed Onshape URLs that we re-sign.
    try {
      const meta = await onshapeFetch<{
        thumbnailInfo?: {
          sizes?: Array<{ size: string; href?: string }>;
        };
      }>({
        path: `/api/v6/parts/d/${opts.documentId}/${wOrV}/e/${opts.elementId}/partid/${partid}`,
      });
      const sizes = meta.thumbnailInfo?.sizes ?? [];
      const exact = sizes.find((s) => s.size === size);
      const fallback = sizes.find((s) => s.href);
      const href = exact?.href ?? fallback?.href;
      if (href) {
        // Hrefs are absolute. Re-route through our signer.
        const u = new URL(href);
        const query: Query = {};
        u.searchParams.forEach((v, k) => {
          query[k] = v;
        });
        return await onshapeFetchRaw({ path: u.pathname, query, accept });
      }
    } catch (err) {
      lastErr = err;
    }

    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `partThumbnail fell back to element thumbnail for part ${opts.partId}:`,
        lastErr,
      );
    }
    return onshape.elementThumbnail({
      documentId: opts.documentId,
      workspaceId: opts.workspaceId,
      versionId: opts.versionId,
      elementId: opts.elementId,
      size: opts.size,
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: pull a complete part snapshot
// ─────────────────────────────────────────────────────────────────────────────

export type PartSnapshot = {
  documentId: string;
  workspaceId?: string;
  versionId?: string;
  elementId: string;
  partId: string;
  name: string;
  partNumber: string;
  material: string | null;
  massGrams: number | null;
  volumeMm3: number | null;
  bbox: { x: number; y: number; z: number } | null;
  microversionId: string | null;
  thumbnailUrl: string;
  url: string;
};

function thumbnailProxyUrl(opts: {
  documentId: string;
  workspaceId?: string;
  versionId?: string;
  elementId: string;
  partId?: string;
}) {
  const search = new URLSearchParams();
  search.set("d", opts.documentId);
  if (opts.workspaceId) search.set("w", opts.workspaceId);
  if (opts.versionId) search.set("v", opts.versionId);
  search.set("e", opts.elementId);
  if (opts.partId) search.set("p", opts.partId);
  return `/api/onshape/thumbnail?${search.toString()}`;
}

export async function fetchPartSnapshot(opts: {
  documentId: string;
  workspaceId?: string;
  versionId?: string;
  elementId: string;
  partId: string;
}): Promise<PartSnapshot> {
  const wOrV = opts.workspaceId
    ? { workspaceId: opts.workspaceId }
    : { versionId: opts.versionId };

  const [parts, mass, bbox, micro] = await Promise.all([
    onshape.listParts({
      documentId: opts.documentId,
      elementId: opts.elementId,
      ...wOrV,
    }),
    onshape
      .partMassProperties({ ...opts })
      .catch(() => null as MassProperties | null),
    onshape
      .partBoundingBox({ ...opts })
      .catch(() => null as BoundingBox | null),
    opts.workspaceId
      ? onshape
          .currentMicroversion({
            documentId: opts.documentId,
            workspaceId: opts.workspaceId,
          })
          .catch(() => null as DocumentMicroversion | null)
      : Promise.resolve(null),
  ]);

  const part = parts.find((p) => p.partId === opts.partId);
  if (!part) {
    throw new Error(`Part ${opts.partId} not found in element ${opts.elementId}`);
  }

  // The mass-properties endpoint keys bodies by the part id. Pull the
  // numeric values out, defaulting to null when not available.
  let massGrams: number | null = null;
  let volumeMm3: number | null = null;
  if (mass) {
    const body =
      mass.bodies[opts.partId] ?? Object.values(mass.bodies)[0];
    if (body) {
      // Onshape returns mass in kilograms, volume in m^3.
      massGrams = body.mass[0] * 1000;
      volumeMm3 = body.volume[0] * 1_000_000_000;
    }
  }
  let box: PartSnapshot["bbox"] = null;
  if (bbox) {
    box = {
      // Onshape returns meters → convert to mm.
      x: (bbox.highX - bbox.lowX) * 1000,
      y: (bbox.highY - bbox.lowY) * 1000,
      z: (bbox.highZ - bbox.lowZ) * 1000,
    };
  }

  return {
    documentId: opts.documentId,
    workspaceId: opts.workspaceId,
    versionId: opts.versionId,
    elementId: opts.elementId,
    partId: opts.partId,
    name: part.name,
    partNumber: part.partNumber || part.partId,
    material: part.material?.displayName ?? part.material?.name ?? null,
    massGrams,
    volumeMm3,
    bbox: box,
    microversionId: micro?.microversion ?? null,
    thumbnailUrl: thumbnailProxyUrl(opts),
    url: `${BASE_URL}/documents/${opts.documentId}/${
      opts.workspaceId ? `w/${opts.workspaceId}` : `v/${opts.versionId}`
    }/e/${opts.elementId}`,
  };
}
