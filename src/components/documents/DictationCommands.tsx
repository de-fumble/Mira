import { X } from "lucide-react";
import { COMMAND_GUIDE } from "@/lib/dictation";

/**
 * The voice commands, shown while dictating: a card beside the document on
 * wide screens, a panel above the dictation controls on phones and tablets.
 */
export function DictationCommands({ caps, onClose, className = "" }: { caps: boolean; onClose?: () => void; className?: string }) {
  return (
    <section aria-label="Voice commands" className={`flex flex-col gap-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Voice commands</h2>
          <p className="mt-1 text-[13px] leading-snug text-ink-3">Pause for a moment, say the command, then carry on. Everything else is typed.</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="btn btn-icon btn-ghost -mr-2 -mt-1 h-9! w-9! flex-none" aria-label="Hide voice commands">
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
      {COMMAND_GUIDE.map((group) => (
        <div key={group.title}>
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{group.title}</h3>
          {group.items.every((i) => i.symbol) ? (
            <ul className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <li key={item.say[0]} className="flex items-center gap-1.5 rounded-lg bg-ink/[0.04] py-1 pl-2 pr-1 text-[13px] font-medium text-ink">
                  {item.say.join(" / ")}
                  <kbd className="min-w-6 rounded-md bg-surface px-1 text-center font-mono text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
                    {item.does}
                  </kbd>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col">
              {group.items.map((item) => (
                <li key={item.say[0]} className="flex items-baseline justify-between gap-3 py-1 text-[14px] leading-snug">
                  <span className="whitespace-nowrap font-medium text-ink">“{item.say[0]}”</span>
                  <span className="text-right text-[13px] text-ink-3">
                    {item.say[0] === "caps off" && caps ? <span className="font-medium text-accent">On now. </span> : null}
                    {item.does}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
