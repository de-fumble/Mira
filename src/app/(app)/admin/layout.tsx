import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminTabs, RefreshButton } from "@/components/admin/AdminNav";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Admin" };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<div className="skeleton h-10 w-48" aria-busy="true" aria-label="Loading admin" />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

/** Nothing below renders unless the viewer is an admin (others get "not found"). */
async function AdminGate({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <div className="mb-7 flex flex-col gap-4 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Admin</p>
          <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.03em] sm:text-[36px]">Mira status</h1>
        </div>
        <div className="flex items-center gap-2">
          <AdminTabs />
          <RefreshButton />
        </div>
      </div>
      {children}
    </>
  );
}
