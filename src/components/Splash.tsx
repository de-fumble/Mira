import { LogoMark } from "./Logo";

/*
 * Runs while the page is still loading, before anything is painted.
 * Shows the splash only when Mira was opened from the home screen
 * (installed web app), and only once per launch — not on every reload.
 */
const SCRIPT = `(function(){var s=document.getElementById("splash");if(!s)return;try{var app=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;if(!app||sessionStorage.getItem("mira-splash"))return;sessionStorage.setItem("mira-splash","1")}catch(e){}s.setAttribute("data-show","")})()`;

/**
 * Launch screen for the installed app: the Mira mark and wordmark on the app
 * background, then a quick fade into the page that has loaded underneath.
 * It hides itself with CSS (see #splash in globals.css), so it can never get
 * stuck, and it doesn't block anything while it's on screen.
 */
export function Splash() {
  return (
    <>
      <div id="splash" aria-hidden suppressHydrationWarning>
        <div className="splash-lockup">
          <LogoMark className="splash-orb h-[84px] w-[84px]" />
          <span className="splash-word">mira</span>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </>
  );
}
