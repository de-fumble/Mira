import { ViewTransition, type ReactNode } from "react";

/**
 * How links say which way the app is moving (Link `transitionTypes`):
 * deeper into a meeting/document, back out of one, or across tabs.
 */
export const NAV_FORWARD = ["nav-forward"];
export const NAV_BACK = ["nav-back"];
export const NAV_TAB = ["tab"];

const MOTION = { "nav-forward": "nav-forward", "nav-back": "nav-back", tab: "tab-fade", default: "none" };

/**
 * Wraps the content area in the app layout. When the screen inside changes,
 * it slides in from the side or cross-fades, matching the link that was
 * tapped. (It sits in the layout because Next keeps visited screens alive in
 * the background, so a screen doesn't always "enter" or "leave" — but the
 * content area always updates.) Changes without a type — browser back,
 * refresh, search, content finishing loading — don't animate, so nothing
 * ever blocks a tap while data streams in.
 */
export function ScreenTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition update={MOTION} default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
