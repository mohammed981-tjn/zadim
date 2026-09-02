"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Languages } from "lucide-react"
import { switchLocalePath, t, type Locale } from "@/lib/i18n"

/**
 * مبدّلُ اللغة — **يحفظ المسار**.
 *
 * ومن كان في صفحة منتجٍ ثم بدّل اللغةَ يبقى في **نفس المنتج**، لا يُقذف
 * إلى الرئيسية. والقذفُ إلى الرئيسية عيبٌ صغيرٌ يجعل التبديلَ عقوبةً:
 * من جرّبه مرّةً لا يعود.
 *
 * ورابطٌ حقيقيّ (`<a>`) لا زرٌّ بـ`onClick`: يُفتح في تبويبٍ جديد،
 * ويُنسَخ عنوانُه، ويقرؤه محرّكُ البحث.
 */
export function LanguageSwitch({ locale }: { locale: Locale }) {
  const pathname = usePathname()
  const other: Locale = locale === "ar" ? "en" : "ar"

  return (
    <Link
      href={switchLocalePath(pathname ?? `/${locale}`, other)}
      hrefLang={other}
      aria-label={t(locale, "nav.languageAria")}
      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <Languages className="size-5" aria-hidden="true" />
      {/*
        🔴 **`lang` على اسم اللغة الأخرى — صحّةٌ في HTML قبل أن تكون
        فحصاً.**

        الاسمُ هنا مكتوبٌ **بلغته**: «العربية» في الصفحة الإنجليزية،
        و«English» في العربية — فمن لا يقرأ لغةَ الصفحة يجب أن يجد
        مخرجَه. وبلا `lang` يقرأ قارئُ الشاشةِ «العربية» بصوتٍ
        إنجليزيٍّ حرفاً حرفاً، فلا يفهمها من احتاجها.

        وتقول للبوّابة كذلك إن هذه العربيةَ **مقصودةٌ لا منسيّة**.
      */}
      <span className="sr-only" lang={other}>
        {t(locale, "nav.language")}
      </span>
    </Link>
  )
}
