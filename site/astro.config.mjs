import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

const legacyDocs = [
  "getting-started",
  "controls",
  "controls-reference",
  "how-it-works",
  "stems",
  "lyrics",
  "usdx",
  "library-sources",
  "scoring",
  "multiplayer",
  "backgrounds",
  "profiles",
  "configuration",
  "self-hosted",
  "docker",
  "building",
  "troubleshooting",
];

export default defineConfig({
  outDir: "dist",
  site: "https://nightingale.cafe",
  redirects: Object.fromEntries([
    ["/docs/introduction.html", "/docs/"],
    ...legacyDocs.map((page) => [`/docs/${page}.html`, `/docs/${page}/`]),
  ]),
  integrations: [
    starlight({
      title: "Nightingale",
      description:
        "Documentation for Nightingale, an open-source karaoke app that turns your music library into karaoke.",
      favicon: "/logo_square.png",
      logo: {
        src: "./src/assets/logo.png",
      },
      customCss: ["./src/styles/docs.css"],
      social: [
        {
          icon: "open-book",
          label: "Nightingale home",
          href: "/",
        },
        {
          icon: "discord",
          label: "Discord",
          href: "https://discord.gg/68Vgng9vYp",
        },
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/rzru/nightingale",
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "docs" },
            { label: "Getting Started", slug: "docs/getting-started" },
            { label: "Controls", slug: "docs/controls" },
            {
              label: "Keyboard & Gamepad",
              slug: "docs/controls-reference",
            },
          ],
        },
        {
          label: "Features",
          items: [
            { label: "How It Works", slug: "docs/how-it-works" },
            { label: "Library Sources", slug: "docs/library-sources" },
            { label: "Stem Separation", slug: "docs/stems" },
            { label: "Lyrics & Transcription", slug: "docs/lyrics" },
            { label: "Song Bundles (.nge)", slug: "docs/song-bundles" },
            { label: "UltraStar Deluxe", slug: "docs/usdx" },
            { label: "Pitch Scoring", slug: "docs/scoring" },
            { label: "Multiplayer", slug: "docs/multiplayer" },
            { label: "Backgrounds", slug: "docs/backgrounds" },
            { label: "Queue From Your Phone", slug: "docs/queue-from-phone" },
            { label: "Profiles", slug: "docs/profiles" },
          ],
        },
        {
          label: "Run Nightingale",
          items: [
            { label: "Configuration", slug: "docs/configuration" },
            { label: "Self-Hosted Web Mode", slug: "docs/self-hosted" },
            { label: "Docker", slug: "docs/docker" },
            { label: "Building from Source", slug: "docs/building" },
            { label: "Troubleshooting", slug: "docs/troubleshooting" },
          ],
        },
      ],
    }),
    sitemap(),
  ],
});
