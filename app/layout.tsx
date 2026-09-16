import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: "Validade em Dia",
    description: "Controle de produtos vencidos e a vencer no estoque.",
    applicationName: "Validade em Dia",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: "/icon-192.png",
      apple: "/icon-192.png",
    },
    openGraph: {
      title: "Validade em Dia",
      description: "Controle de produtos por validade",
      type: "website",
      images: [{ url: new URL("/og.png", metadataBase).toString(), width: 1734, height: 907, alt: "Validade em Dia" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Validade em Dia",
      description: "Controle de produtos por validade",
      images: [new URL("/og.png", metadataBase).toString()],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#164b38",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
