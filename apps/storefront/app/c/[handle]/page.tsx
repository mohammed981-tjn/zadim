import type { Metadata } from "next"
import { Container } from "@/components/container"
import { ProductGrid } from "@/components/product-grid"
import { EmptyState, ErrorState } from "@/components/states"
import { getCategoryProducts } from "@/lib/medusa"
import { toArabicDigits } from "@/lib/money"

type Params = { handle: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params
  return { title: `${decodeURIComponent(handle)} — زادم` }
}

export default async function CategoryPage({ params }: { params: Promise<Params> }) {
  const { handle } = await params

  let data
  try {
    data = await getCategoryProducts(handle)
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title="تعذّر تحميل القسم" />
      </Container>
    )
  }

  if (!data.category) {
    return (
      <Container className="py-16">
        <EmptyState
          title="القسم غير موجود"
          description="لم نعثر على هذا القسم. تصفّح بقية المتجر من الصفحة الرئيسية."
          actionHref="/"
          actionLabel="العودة للرئيسية"
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
          {toArabicDigits(String(count))} منتج
        </p>
      </header>

      {products.length ? (
        <ProductGrid products={products} priorityCount={4} />
      ) : (
        <EmptyState
          title="لا توجد منتجات في هذا القسم"
          description="تصفّح بقية الأقسام من الصفحة الرئيسية."
          actionHref="/"
          actionLabel="العودة للرئيسية"
        />
      )}
    </Container>
  )
}
