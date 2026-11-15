import type { MetadataRoute } from "next";

// Lets people install Mira to their phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mira — meeting notes",
    short_name: "Mira",
    description: "Record your meetings and read every word.",
    start_url: "/",
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
