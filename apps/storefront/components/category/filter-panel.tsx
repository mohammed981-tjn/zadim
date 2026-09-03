"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { X } from "lucide-react"
import type { CategoryFilter } from "@/lib/medusa"
import { digits } from "@/lib/money"
import { t, type Locale } from "@/lib/i18n"

/**
 * لوحُ التصفية بالخصائص (بند ٣).
 *
 * ── ولماذا الحالةُ في العنوان لا في `useState` ───────────────────
 *
 * لأن تصفيةً لا تُنسخ في رابطٍ ليست تصفية: الزائرُ لا يستطيع مشاركةَ
 * ما وجده، ولا العودةَ إليه بزرّ الرجوع، ولا فتحَه في تبويبٍ ثانٍ.
 * والعنوانُ يعطي الثلاثةَ مجّاناً.
 *
 * ⚠️ **والصفحةُ خادميّة**: تغييرُ العنوان يُعيد جلبَ المنتجات
 * والأعدادِ معاً من الخادم — فلا تُحسب الأعدادُ في المتصفّح ولا
 * تفترق عمّا يراه.
 *
 * 🔴 **ولذلك تلزم حالةٌ متفائلة — وهذا ما أمسكته البوّابة.**
 *
 * الخانةُ محكومةٌ بما يصل من الخادم. فالضغطةُ كانت **لا تُغيّر شيئاً
 * على الشاشة** حتى يردّ الخادم: React يُعيد الرسمَ بالقيمة القديمة
 * فتعود الخانةُ فارغة. سقطت البوّابةُ بـ«الضغطُ لم يغيّر حالَ الخانة»
 * — وهي على شبكةٍ محلّية؛ وعلى شبكةِ جوّالٍ بطيئةٍ يضغط الزائرُ ثم
 * يضغط ثانيةً ظنّاً أن الضغطةَ ضاعت، **فيُلغي اختيارَه بنفسه**.
 *
 * و`useOptimistic` يُظهر الاختيارَ فوراً ثم يتخلّى عنه من نفسه حين
 * تصل الحقيقةُ من الخادم — فلا حالةَ ثانيةٌ تُدار يدوياً وتفترق.
 */
export function FilterPanel({
  filters,
  locale,
}: {
  filters: CategoryFilter[]
  locale: Locale
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [shown, applyOptimistic] = useOptimistic(
    filters,
    (state, picked: { code: string; value: string; on: boolean }) =>
      state.map((f) =>
        f.attribute_code !== picked.code
          ? f
          : {
              ...f,
              values: f.values.map((v) =>
                v.value === picked.value ? { ...v, selected: picked.on } : v,
              ),
            },
      ),
  )

  if (!filters.length) return null

  const selectedCount = shown.reduce(
    (n, f) => n + f.values.filter((v) => v.selected).length,
    0,
  )

  function toggle(code: string, value: string, on: boolean) {
    const next = new URLSearchParams(params.toString())
    const key = `attr[${code}]`
    const current = next.getAll(key)
    next.delete(key)
    for (const v of current) {
      if (v !== value) next.append(key, v)
    }
    if (on) next.append(key, value)

    const qs = next.toString()
    startTransition(() => {
      applyOptimistic({ code, value, on })
      // `scroll: false` — الزائرُ ينظر إلى اللوح حين يضغط، وقفزُ الصفحة
      // إلى أعلاها يجعله يبحث عن موضعه بعد كل اختيار.
      router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
    })
  }

  return (
    <aside
      aria-labelledby="filters-heading"
      // الأعدادُ وحدَها تبهت أثناء الجلب — لا الخانات: خانةٌ باهتةٌ
      // تبدو معطَّلة، والزائرُ ينتظر بدل أن يختار الثانية.
      aria-busy={isPending}
      className="space-y-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="filters-heading" className="text-sm font-bold">
          {t(locale, "category.filters")}
        </h2>
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={() => startTransition(() => router.push(pathname, { scroll: false }))}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            <X className="size-3.5" aria-hidden />
            {t(locale, "category.clearFilters")}
          </button>
        ) : null}
      </div>

      {shown.map((f) => (
        <fieldset key={f.attribute_code} className="space-y-2">
          <legend className="mb-1 text-sm font-medium">{f.name_ar}</legend>
          {f.values.map((v) => (
            <label key={v.value} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-[var(--primary)]"
                checked={v.selected}
                onChange={(e) => toggle(f.attribute_code, v.value, e.target.checked)}
              />
              <span className="min-w-0 flex-1 truncate">{v.value}</span>
              {/* العددُ يُعرض دائماً — وهو محسوبٌ على المجموعة المصفّاة
                  بما عدا هذه الخاصية، فيبقى صادقاً بعد الاختيار ولا
                  يصير صفراً لكلّ ما لم يُختر. */}
              <span
                className={`tabular shrink-0 text-xs text-muted-foreground transition-opacity ${
                  isPending ? "opacity-40" : ""
                }`}
              >
                {digits(locale, String(v.count))}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
    </aside>
  )
}
