import type { Metadata, Viewport } from "next"
import { IBM_Plex_Sans_Arabic } from "next/font/google"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import "./globals.css"

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-arabic",
  fallback: ["system-ui", "Segoe UI", "Tahoma", "Arial"],
})

export const metadata: Metadata = {
  title: "زادم — متجرك السعودي",
  description: "زادم متجر إلكتروني سعودي يقدّم منتجات مختارة بعناية وتجربة تسوّق راقية.",
}

export const viewport: Viewport = {
  themeColor: "#f9f8f4",
  colorScheme: "light",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} bg-background`}>
      <body className="font-sans antialiased">
        <div className="flex min-h-dvh flex-col">
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}
