import { Suspense } from "react";
import { HeaderBrand, HeaderRecordButton, RecordLink, UserMenu } from "@/components/AppHeader";
import { getViewer } from "@/lib/admin";
import { getFeatures } from "@/lib/features";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-[1.8]">
        <div className="px-safe mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 sm:px-6">
          <HeaderBrand />
          <div className="flex items-center gap-2.5">
            <Suspense fallback={<RecordLink />}>
              <HeaderRecord />
            </Suspense>
            <Suspense fallback={<div className="h-10 w-10 rounded-full bg-sunken" />}>
              <Account />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="px-safe mx-auto w-full max-w-5xl flex-1 pb-32 pt-6 sm:px-6 sm:pb-28 sm:pt-12">{children}</main>
    </>
  );
}

/** Hidden when Recording is switched off in the admin dashboard. */
async function HeaderRecord() {
  const { recording } = await getFeatures();
  return recording ? <HeaderRecordButton /> : null;
}

async function Account() {
  const viewer = await getViewer();
  return <UserMenu email={viewer.email ?? ""} name={viewer.username} isAdmin={viewer.isAdmin} />;
}
