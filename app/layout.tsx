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
    title: "Vencimento de Produtos",
    description: "AgroConfiança: controle de produtos vencidos e a vencer no estoque.",
    applicationName: "AgroConfiança · Vencimento de Produtos",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: "/agroconfianca-app.png",
      apple: "/agroconfianca-app.png",
    },
    openGraph: {
      title: "Vencimento de Produtos",
      description: "AgroConfiança · Controle de produtos por validade",
      type: "website",
      images: [{ url: new URL("/agroconfianca-app.png", metadataBase).toString(), width: 1024, height: 1024, alt: "AgroConfiança · Vencimento de Produtos" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Vencimento de Produtos",
      description: "AgroConfiança · Controle de produtos por validade",
      images: [new URL("/agroconfianca-app.png", metadataBase).toString()],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#086000",
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
