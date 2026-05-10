import type { Metadata } from "next";
import { SidebarApp } from "./sidebar-client";

export const metadata: Metadata = {
  title: "SpikeParts · Onshape sidebar",
  // Onshape iframes us; don't let search engines index the panel.
  robots: { index: false, follow: false },
};

/**
 * The page entry is intentionally tiny. Onshape passes context as URL
 * search params; we read them on the client (postMessage origin check
 * needs the same `server` value, so the whole flow lives client-side).
 */
export default function OnshapeSidebarPage() {
  return <SidebarApp />;
}
