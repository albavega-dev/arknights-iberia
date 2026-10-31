import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ogSiteImageUrl } from "../game-data/operator-og-images";
import { getSiteOrigin, previewImage, siteDescription, siteName, siteTitle } from "../game-data/seo";
import { SiteShell } from "./site-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteOrigin()),
  title: { default: `${siteTitle} | ${siteName}`, template: `%s | ${siteName}` },
  description: siteDescription,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName, locale: "es_ES", title: `${siteTitle} | ${siteName}`, description: siteDescription, url: "/", images: [previewImage(ogSiteImageUrl())] },
  twitter: { card: "summary_large_image", title: `${siteTitle} | ${siteName}`, description: siteDescription, images: [ogSiteImageUrl()] },
  icons: {
    icon: "/assets/anchor.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body><SiteShell>{children}</SiteShell></body>
    </html>
  );
}
