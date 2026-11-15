import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Mira", template: "%s · Mira" },
  description: "Record your meetings and read every word.",
  applicationName: "Mira",
  // "Add to Home Screen" on iPhone opens Mira full-screen, like an app.
  appleWebApp: { capable: true, title: "Mira", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

// Light only — also tells browsers not to force a dark theme on the page.
// viewport-fit=cover lets the layout use the full screen on notched phones;
// the .pb-safe / .px-safe helpers keep content clear of the notch and home bar.
export const viewport: Viewport = {
  colorScheme: "only light",
  themeColor: "#f5f5f7",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <TimeZoneSync />
      </body>
    </html>
  );
}
