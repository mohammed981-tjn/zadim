import type { Metadata } from "next"
import { Container } from "@/components/container"
import { ProductGrid } from "@/components/product-grid"
import { EmptyState, ErrorState } from "@/components/states"
import { FilterPanel } from "@/components/category/filter-panel"
import { decodeHandle, getCategoryProducts, type FilterSelection } from "@/lib/medusa"
import { digits } from "@/lib/money"
import { t, type Locale } from "@/lib/i18n"

type Params = { handle: string; locale: Locale }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle, locale } = await params
  return { title: `${decodeHandle(handle)} — ${t(locale, "site.name")}` }
}

/**
 * يقرأ `?attr[color]=أحمر&attr[color]=أزرق` من العنوان.
 *
 * ⚠️ **وما لا يطابق الشكلَ يُتجاهَل** لا يُمرَّر: رابطٌ قديمٌ بخاصيةٍ
 * حُذفت يعرض التصنيفَ كاملاً، ولا يسقط في وجه صاحبه.
 */
function readSelection(sp: Record<string, string | string[] | undefined>): FilterSelection {
  const out: FilterSelection = {}
  for (const [key, raw] of Object.entries(sp)) {
    const m = /^attr\[([a-z0-9_-]{1,64})\]$/i.exec(key)
    if (!m || raw === undefined) continue
    const values = (Array.isArray(raw) ? raw : [raw]).filter((v) => v.trim().length > 0)
    if (values.length) out[m[1]] = values
  }
  return out
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { handle, locale } = await params
  const selection = readSelection(await searchParams)

  let data
  try {
    data = await getCategoryProducts(handle, locale, selection)
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

  const { category, products, count, filters } = data
  const filtering = Object.keys(selection).length > 0

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

      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <FilterPanel filters={filters} locale={locale} />

        <div className="min-w-0">
          {products.length ? (
            <ProductGrid products={products} locale={locale} priorityCount={4} />
          ) : (
            /* ⚠️ **ورسالتان لا واحدة**: تصنيفٌ فارغٌ يقول «لا بضاعةَ
               هنا»، وتصفيةٌ بلا نتيجةٍ تقول «أزِلْ بعضَ الخيارات» —
               والأولى تجعل الزائرَ يغادر، والثانية تجعله يجرّب. */
            <EmptyState
              title={t(locale, filtering ? "category.noMatch" : "category.empty")}
              description={t(locale, filtering ? "category.noMatchHint" : "category.emptyHint")}
              actionHref={filtering ? `/${locale}/c/${handle}` : `/${locale}`}
              actionLabel={t(
                locale,
                filtering ? "category.clearFilters" : "home.backHome",
              )}
            />
          )}
        </div>
      </div>
    </Container>
  )
}
