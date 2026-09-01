import Link from "next/link"
import { Container } from "@/components/container"
import { t, type Locale } from "@/lib/i18n"
import { digits } from "@/lib/money"

export function SiteFooter({ locale }: { locale: Locale }) {
  // السَّنَةُ بأرقام لغتها: العربيةُ هندية، والإنجليزيةُ لاتينية.
  const year = String(new Date().getFullYear())
  return (
    <footer className="mt-16 border-t border-border bg-card">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <span className="text-xl font-bold text-primary">{t(locale, "site.name")}</span>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground text-pretty">
            {t(locale, "site.footerNote")}
          </p>
        </div>
        <nav aria-label={t(locale, "nav.home")} className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href={`/${locale}`} className="text-muted-foreground transition-colors hover:text-foreground">
            {t(locale, "nav.home")}
          </Link>
          <Link href={`/${locale}/cart`} className="text-muted-foreground transition-colors hover:text-foreground">
            {t(locale, "nav.cart")}
          </Link>
        </nav>
      </Container>
      <div className="border-t border-border">
        <Container className="py-4">
          <p className="tabular text-center text-xs text-muted-foreground">
            {t(locale, "site.rights")} {digits(locale, year)}
          </p>
        </Container>
      </div>
    </footer>
  )
}
