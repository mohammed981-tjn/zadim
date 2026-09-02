import { Suspense } from "react"
import Link from "next/link"
import { ShoppingBag } from "lucide-react"
import { Container } from "@/components/container"
import { SearchBar } from "@/components/search-bar"
import { loadCart } from "@/lib/cart-actions"
import { digits } from "@/lib/money"
import { LanguageSwitch } from "@/components/language-switch"
import { t, type Locale } from "@/lib/i18n"

async function cartCount(): Promise<number> {
  try {
    const cart = await loadCart()
    return cart?.items?.reduce((sum, l) => sum + l.quantity, 0) ?? 0
  } catch {
    return 0
  }
}

export async function SiteHeader({ locale }: { locale: Locale }) {
  const count = await cartCount()

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Container className="flex h-16 items-center gap-3 sm:h-20 sm:gap-6">
        <Link
          href={`/${locale}`}
          className="flex shrink-0 items-center gap-2"
          aria-label={t(locale, "nav.homeAria")}
        >
          <span className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
            {t(locale, "site.name")}
          </span>
        </Link>

        {/* `SearchBar` يقرأ `useSearchParams`، و`Suspense` شرطُ Next
            لذلك: بدونه يسقط بناءُ صفحة ٤٠٤ الساكنة كلَّ مرّة
            («useSearchParams() should be wrapped in a suspense
            boundary»). والبديلُ الفارغ بمقاس الحقل نفسِه — كي لا تقفز
            الترويسةُ عند الترطيب فيرتفع CLS. */}
        <div className="flex-1">
          <Suspense fallback={<div className="h-11 rounded-xl bg-muted/60" />}>
            <SearchBar locale={locale} />
          </Suspense>
        </div>

        <Link
          href={`/${locale}/cart`}
          className="relative flex size-11 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-muted"
          aria-label={`${t(locale, "nav.cartAria")}${count ? ` — ${count}` : ""}`}
        >
          <ShoppingBag className="size-6" aria-hidden="true" />
          {count > 0 ? (
            <span className="tabular absolute -top-1 -end-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">
              {digits(locale, count)}
            </span>
          ) : null}
        </Link>

        <LanguageSwitch locale={locale} />
      </Container>
    </header>
  )
}
