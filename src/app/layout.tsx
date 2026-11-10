import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { StepUpProvider } from "@/components/StepUp";
import { THEME_SCRIPT } from "@/lib/theme-script";

export const metadata: Metadata = {
  title: { default: "PryingEyes", template: "%s · PryingEyes" },
  description: "Share a code, not your number. People reach you through a verified, logged gate.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [
  { media: "(prefers-color-scheme: light)", color: "#EEF4F9" },
  { media: "(prefers-color-scheme: dark)", color: "#081120" },
] };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
