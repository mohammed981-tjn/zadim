import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Container } from "@/components/container"
import { EmptyState, ErrorState } from "@/components/states"
import { search } from "@/lib/medusa"
import { digits } from "@/lib/money"
import { t, type Locale } from "@/lib/i18n"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<{ q?: string }>
}): Promise<Metadata> {
  const [{ locale }, { q }] = await Promise.all([params, searchParams])
  return {
    title: q
      ? `${t(locale, "search.resultsFor")} “${q}” — ${t(locale, "site.name")}`
      : `${t(locale, "search.title")} — ${t(locale, "site.name")}`,
  }
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>
  searchParams: Promise<{ q?: string }>
}) {
  const [{ locale }, { q = "" }] = await Promise.all([params, searchParams])
  const query = q.trim()

  if (!query) {
    return (
      <Container className="py-16">
        <EmptyState title={t(locale, "search.prompt")} description={t(locale, "search.promptHint")} />
      </Container>
    )
  }

  let result
  try {
    result = await search(query, locale)
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title={t(locale, "search.failed")} />
      </Container>
    )
  }

  // 🔴 **السهمُ يتبع الاتجاه، ولا يمسكه فاحصُ الصفوف.**
  //
  // فاحصُ `verify-ui.mjs` يمنع `ml-`/`right-` — صفوفاً تُقرأ. وهذا
  // أيقونةٌ: `ChevronLeft` في صفحةٍ إنجليزيةٍ سهمٌ يشير إلى الخلف بينما
  // الرابطُ يمضي إلى الأمام. لا صفَّ خاطئاً فيه، والعينُ وحدَها تراه.
  const Arrow = locale === "ar" ? ChevronLeft : ChevronRight
  const count = digits(locale, result.count)
  const quote = locale === "ar" ? ["«", "»"] : ["“", "”"]

  return (
    <Container className="py-8 sm:py-12">
      <header className="mb-8 space-y-1">
        {/*
          🔴 **نصُّ الزائر يُعزل ويُعلَّم — ولا يُدمج في العنوان.**

          استعلامٌ عربيٌّ داخل عنوانٍ إنجليزيّ يخلط الاتجاهات: تقفز
          علامتا التنصيص إلى غير موضعهما ويُقرأ السطرُ مقلوباً.
          و`<bdi>` هو العنصرُ الذي وُضع لهذا بالضبط: يعزل اتجاهَ ما
          بداخله عن محيطه.

          و`data-user-content` تقول لبوّابة الواجهة: **هذه ليست
          ترجمةً ناقصة**. فالبوّابة تمنع العربيةَ في `/en`، وعربيةُ
          الزائر ليست عيباً — عيبٌ أن يُخفى ما كتبه أو يُترجَم.
        */}
        <h1 className="text-2xl font-bold text-balance sm:text-3xl">
          {t(locale, "search.resultsFor")}{" "}
          <bdi data-user-content>
            {quote[0]}
            {query}
            {quote[1]}
          </bdi>
        </h1>
        <p className="tabular text-sm text-muted-foreground">
          {t(locale, "search.count", { count })}
        </p>
      </header>

      {result.products.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {result.products.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${locale}/p/${p.handle}`}
                className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-muted"
              >
                <span className="font-medium text-foreground text-pretty">{p.title}</span>
                <Arrow className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={t(locale, "search.empty")}
          description={t(locale, "search.noMatch")}
          actionHref={`/${locale}`}
          actionLabel={t(locale, "search.browse")}
        />
      )}
    </Container>
  )
}
