import type { Metadata } from "next"
import { Container } from "@/components/container"
import { ProductGrid } from "@/components/product-grid"
import { EmptyState, ErrorState } from "@/components/states"
import { getCategoryProducts } from "@/lib/medusa"
import { digits } from "@/lib/money"
import { t, type Locale } from "@/lib/i18n"

type Params = { handle: string; locale: Locale }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle, locale } = await params
  return { title: `${decodeURIComponent(handle)} — ${t(locale, "site.name")}` }
}

export default async function CategoryPage({ params }: { params: Promise<Params> }) {
  const { handle, locale } = await params

  let data
  try {
    data = await getCategoryProducts(handle, locale)
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title={t(locale, "category.loadFailed")} />
      </Container>
    )
  }

  if (!data.category) {
    return (
      <Container className="py-16">
        <EmptyState
          title={t(locale, "category.notFound")}
          description={t(locale, "category.notFoundHint")}
          actionHref={`/${locale}`}
          actionLabel={t(locale, "home.backHome")}
        />
      </Container>
    )
  }

  const { category, products, count } = data

  return (
    <Container className="py-8 sm:py-12">
      <header className="mb-8 space-y-2">
        <h1 className="text-2xl font-bold text-balance sm:text-3xl">{category.name}</h1>
        {category.description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
            {category.description}
          </p>
        ) : null}
        <p className="tabular text-sm text-muted-foreground">
          {t(locale, "category.count", {
            count: digits(locale, count),
          })}
        </p>
      </header>

      {products.length ? (
        <ProductGrid products={products} locale={locale} priorityCount={4} />
      ) : (
        <EmptyState
          title={t(locale, "category.empty")}
          description={t(locale, "category.emptyHint")}
          actionHref={`/${locale}`}
          actionLabel={t(locale, "home.backHome")}
        />
      )}
    </Container>
  )
}
