/**
 * Onshape integrated-app right-panel bridge.
 *
 * What this is
 * ────────────
 * Onshape "Element right panel" extensions are plain web pages that Onshape
 * embeds in an <iframe> inside the document UI. The page learns its context
 * (which document/workspace/element the user is viewing) from query params
 * Onshape appends to the iframe src, and talks to the host Onshape window
 * over `postMessage`.
 *
 * Protocol notes
 * ──────────────
 *   - Onshape will not send messages to the iframe until the iframe has sent
 *     `applicationInit` first. We do that on mount.
 *   - All inbound messages have `event.origin === server` (the `server`
 *     query param). Anything else is a forgery; ignore it.
 *   - All outbound messages MUST echo `documentId`, `workspaceId`, and
 *     `elementId` so Onshape can route the response. We attach those
 *     automatically inside `sendMessage`.
 *
 * Setup (Onshape side)
 * ────────────────────
 *   1. Go to dev-portal.onshape.com → OAuth applications → your app →
 *      Extensions → Add extension.
 *   2. Location:  Element right panel
 *      Context:   Part Studio (and/or Assembly, if you want it there too)
 *      Action URL:
 *        https://YOUR_HOST/onshape/sidebar
 *   3. Save and reload the document in Onshape — the panel shows up under
 *      the right-side icon strip.
 *
 * SpikeParts continues to use API keys for the actual REST calls
 * (see src/lib/onshape/client.ts). The integrated-app extension is just the
 * UI surface; the server still talks to Onshape with the existing HMAC
 * signing, so the same user must own both the iframe page and the API keys.
 */

export type OnshapeContext = {
  /** Document the user is viewing. */
  documentId: string;
  /** Set when the user is on a workspace (live edit). */
  workspaceId?: string;
  /** Set when the user is on a named version. */
  versionId?: string;
  /** Currently active tab/element (Part Studio, Assembly, …). */
  elementId?: string;
  /** Origin of the Onshape host (e.g. https://cad.onshape.com). Used for
   *  postMessage origin validation. */
  server: string;
  companyId?: string;
  userId?: string;
  locale?: string;
  clientId?: string;
};

export function readContextFromUrl(): OnshapeContext | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const documentId = params.get("documentId");
  if (!documentId) return null;
  // Onshape passes `server` as the host origin. Default to cad.onshape.com
  // for local testing where the iframe is opened standalone.
  const rawServer = params.get("server") || "https://cad.onshape.com";
  let server = rawServer;
  try {
    server = new URL(rawServer).origin;
  } catch {
    server = "https://cad.onshape.com";
  }
  return {
    documentId,
    workspaceId: params.get("workspaceId") || undefined,
    versionId: params.get("versionId") || undefined,
    elementId: params.get("elementId") || undefined,
    server,
    companyId: params.get("companyId") || undefined,
    userId: params.get("userId") || undefined,
    locale: params.get("locale") || undefined,
    clientId: params.get("clientId") || undefined,
  };
}

/** True when the page is loaded as the top-level document, not inside an iframe. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.parent === window;
  } catch {
    return false;
  }
}

type OutboundExtras = Record<string, unknown>;

const DEBUG = typeof window !== "undefined" && process.env.NODE_ENV !== "production";

function sendMessage(ctx: OnshapeContext, name: string, extras?: OutboundExtras) {
  if (typeof window === "undefined" || isStandalone()) return;
  const payload = {
    documentId: ctx.documentId,
    workspaceId: ctx.workspaceId,
    elementId: ctx.elementId,
    messageName: name,
    ...extras,
  };
  if (DEBUG) {
    console.debug("[onshape] →", name, { target: ctx.server, payload });
  }
  window.parent.postMessage(payload, ctx.server);
}

export function applicationInit(ctx: OnshapeContext) {
  sendMessage(ctx, "applicationInit");
}

export function showMessageBubble(ctx: OnshapeContext, message: string) {
  sendMessage(ctx, "showMessageBubble", { message });
}

/**
 * Asks Onshape to switch into selection mode and stream picks back via
 * SELECTION messages tagged with our `messageId`.
 *
 * Per the docs: when `requiredSelectionCount` is 0 / omitted the request is
 * unbounded — selections stream as PENDING and the request only ends when
 * we send `stopRequest`. When set to N > 0, Onshape silently waits until
 * the user picks exactly N entities, then sends one SUCCESS message and
 * auto-ends. We always want streaming, so we omit the count.
 */
export function requestBodySelection(
  ctx: OnshapeContext,
  opts: { messageId: string },
) {
  sendMessage(ctx, "requestSelection", {
    messageId: opts.messageId,
    entityTypeSpecifier: ["BODY"],
    // 0 = unbounded; we drive end-of-pick via stopRequest below.
    requiredSelectionCount: 0,
  });
}

export function stopRequest(ctx: OnshapeContext) {
  sendMessage(ctx, "stopRequest");
}

/**
 * The shape of an entry in the inbound `selections` array. Per Onshape's
 * docs the field that identifies a body is `selectionId` (the body's
 * deterministic ID); other fields are kept as fallbacks because Onshape
 * has historically varied between releases.
 */
export type OnshapeSelectionEntity = {
  selectionType?: "ENTITY" | "BODY" | "GEOMETRY" | string;
  selectionId?: string;
  entityType?: string;
  bodyType?: string;
  geometryType?: string;
  // Legacy / undocumented fallbacks observed in the wild.
  deterministicId?: string;
  partId?: string;
};

export type OnshapeInboundMessage = {
  /**
   * Real message names observed in the wild. Onshape's docs say `SELECTION`
   * and `stoppedMessageId`, but the host actually sends:
   *   - `REQUESTED_SELECTION` for streaming picks (selections grows per click)
   *   - `STOPPED_REQUEST` after we stopRequest (carries `stoppedRequestId`)
   * We match on these to be safe and keep the docs' names as fallbacks.
   */
  messageName:
    | "REQUESTED_SELECTION"
    | "STOPPED_REQUEST"
    | "SELECTION"
    | string;
  messageId?: string;
  /** Onshape sends a status object like { value: 'PENDING' | 'SUCCESS' | … }. */
  status?: { value?: string } | string;
  /** Set on STOPPED_REQUEST; echoes the original requestSelection messageId. */
  stoppedRequestId?: string;
  /** Older docs name: kept for safety. */
  stoppedMessageId?: string;
  selections?: OnshapeSelectionEntity[];
} & Record<string, unknown>;

/**
 * Subscribes to inbound postMessages, validating the origin matches the
 * `server` we got from the URL. Returns the unsubscribe function.
 */
export function listenForMessages(
  ctx: OnshapeContext,
  handler: (msg: OnshapeInboundMessage) => void,
) {
  if (typeof window === "undefined") return () => {};
  const fn = (e: MessageEvent) => {
    // In dev, log EVERYTHING — even rejected messages — so we can see
    // when origin mismatches or non-object payloads are silently dropped.
    if (DEBUG) {
      const isObject = typeof e.data === "object" && e.data !== null;
      const messageName = isObject
        ? (e.data as Record<string, unknown>).messageName
        : undefined;
      console.debug("[onshape] ←", {
        origin: e.origin,
        expectedOrigin: ctx.server,
        originMatches: e.origin === ctx.server,
        messageName,
        data: e.data,
      });
    }
    if (e.origin !== ctx.server) return;
    if (typeof e.data !== "object" || e.data === null) return;
    const data = e.data as Record<string, unknown>;
    if (typeof data.messageName !== "string") return;
    handler(data as OnshapeInboundMessage);
  };
  window.addEventListener("message", fn);
  return () => window.removeEventListener("message", fn);
}
