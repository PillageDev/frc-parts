/**
 * Layout for routes that are loaded inside an Onshape <iframe>.
 *
 * No global Sidebar/Topbar — the panel is narrow (Onshape's right-panel
 * iframe is ~320–400px wide) and any chrome we'd add gets clipped. Just
 * a full-bleed surface; the page itself draws the header.
 */
export default function OnshapeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {children}
    </div>
  );
}
