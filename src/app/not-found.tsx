import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="flex flex-1 animate-page flex-col items-center justify-center px-6 py-24 text-center">
      <LogoMark className="h-12 w-12" />
      <h1 className="mt-6 text-[28px] font-semibold tracking-[-0.03em]">We couldn’t find that</h1>
      <p className="mt-2 max-w-sm text-[16px] text-ink-3">
        The meeting may have been deleted, or the link isn’t quite right.
      </p>
      <Link href="/" className="btn btn-md btn-primary mt-8">
        Back to meetings
      </Link>
    </main>
  );
}
