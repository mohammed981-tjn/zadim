import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { Container } from "@/components/container"
import { EmptyState, ErrorState } from "@/components/states"
import { search } from "@/lib/medusa"
import { toArabicDigits } from "@/lib/money"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}): Promise<Metadata> {
  const { q } = await searchParams
  return { title: q ? `نتائج البحث عن «${q}» — زادم` : "البحث — زادم" }
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams
  const query = q.trim()

  if (!query) {
    return (
      <Container className="py-16">
        <EmptyState title="ابحث في المتجر" description="اكتب اسم المنتج الذي تبحث عنه في شريط البحث بالأعلى." />
      </Container>
    )
  }

  let result
  try {
    result = await search(query)
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title="تعذّر تنفيذ البحث" />
      </Container>
    )
  }

  return (
    <Container className="py-8 sm:py-12">
      <header className="mb-8 space-y-1">
        <h1 className="text-2xl font-bold text-balance sm:text-3xl">نتائج البحث عن «{query}»</h1>
        <p className="tabular text-sm text-muted-foreground">
          {toArabicDigits(String(result.count))} نتيجة
        </p>
      </header>

      {result.products.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {result.products.map((p) => (
            <li key={p.id}>
              <Link
                href={`/p/${p.handle}`}
                className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-muted"
              >
                <span className="font-medium text-foreground text-pretty">{p.title}</span>
                <ChevronLeft className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="لا توجد نتائج"
          description={`لم نعثر على منتجات تطابق «${query}». جرّب كلمات بحث أخرى.`}
          actionHref="/"
          actionLabel="تصفّح المتجر"
        />
      )}
    </Container>
  )
}
