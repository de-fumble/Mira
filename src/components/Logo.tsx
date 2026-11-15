export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`${className} block flex-none rounded-full shadow-[0_2px_8px_-2px_rgb(0_0_0/0.45),inset_0_1px_0_rgb(255_255_255/0.25)]`}
      style={{ background: "radial-gradient(circle at 32% 26%, #9a9aa0 0%, #2c2c2e 46%, #000 100%)" }}
    />
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="text-[21px] font-semibold tracking-[-0.04em]">mira</span>
    </span>
  );
}
