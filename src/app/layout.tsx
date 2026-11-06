import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/merriweather/300.css";
import "@fontsource/merriweather/400.css";
import "@fontsource/merriweather/700.css";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { StepUpProvider } from "@/components/StepUp";

export const metadata: Metadata = {
  title: { default: "PryingEyes", template: "%s · PryingEyes" },
  description: "Share a code, not your number. People reach you through a verified, logged gate.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F6EEF2" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('pe-theme');if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();` }} />
        <a className="skip" href="#main">Skip to content</a>
        <StepUpProvider>
          <Shell />
          <main id="main">{children}</main>
          <footer className="foot">
            <span>© {new Date().getFullYear()} PryingEyes</span>
            <a href="/privacy">Privacy notice</a>
            <span>PryingEyes is not an emergency service. In an emergency, call 999 in Eswatini or your local emergency number.</span>
          </footer>
        </StepUpProvider>
      </body>
    </html>
  );
}
