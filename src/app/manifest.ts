import type { MetadataRoute } from "next";

// Lets people install Mira to their phone's home screen. Android builds its
// launch screen from this: the icon and `name` on `background_color`.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mira",
    short_name: "Mira",
    description: "Record meetings and dictate documents — Mira writes every word.",
    // ?source=pwa: signed-out people opening the app go to sign-in, not the website.
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
