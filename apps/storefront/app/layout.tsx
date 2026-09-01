import type { Metadata, Viewport } from "next"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import "./globals.css"

// ⚠️ تم استبدال Google Fonts بـ system fonts لضمان العمل بدون اتصال إنترنت
// في بيئات الـ CI/CD والـ Vercel. الخط الأساسي سيكون الخط النظام للعربية.
// يمكن استخدام local fonts في المستقبل إذا أُضيفت إلى public/fonts/

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
    <html lang="ar" dir="rtl" className="bg-background">
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
