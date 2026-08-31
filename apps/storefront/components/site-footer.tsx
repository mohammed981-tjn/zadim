import Link from "next/link"
import { Container } from "@/components/container"

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-card">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <span className="text-xl font-bold text-primary">زادم</span>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground text-pretty">
            منتجات مختارة بعناية وتجربة تسوّق سعودية راقية. الأسعار شاملة ضريبة القيمة المضافة.
          </p>
        </div>
        <nav aria-label="روابط سريعة" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">
            الرئيسية
          </Link>
          <Link href="/cart" className="text-muted-foreground transition-colors hover:text-foreground">
            السلة
          </Link>
        </nav>
      </Container>
      <div className="border-t border-border">
        <Container className="py-4">
          <p className="tabular text-center text-xs text-muted-foreground">
            جميع الحقوق محفوظة — زادم ٢٠٢٦
          </p>
        </Container>
      </div>
    </footer>
  )
}
