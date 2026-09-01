import type { Metadata, Viewport } from "next"
import { notFound } from "next/navigation"
import { IBM_Plex_Sans_Arabic } from "next/font/google"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { dirOf, isLocale, t, type Locale } from "@/lib/i18n"

/**
 * 🔴 **اللغةُ والاتجاهُ من المسار، لا ثابتين في الكود.**
 *
 * وكانا `lang="ar" dir="rtl"` مكتوبين في الجذر. وصفحةٌ إنجليزيةٌ تحت
 * `dir="rtl"` ليست إنجليزيةً بل عربيةَ التخطيط بحروفٍ لاتينية: الفواصلُ
 * في الجهة الخطأ، والقوائمُ تبدأ من اليمين، وقارئُ الشاشة يُعلن العربية.
 */
/**
 * ⚠️ **والأوزانُ أربعةٌ لأن الواجهة تستعمل أربعة.**
 *
 * كان الوزنُ `300` محمَّلاً ولا صفَّ واحدٌ في المتجر يستعمله
 * (`font-light` معدومة؛ والمستعمَلُ `medium`/`semibold`/`bold` وأصلُ
 * الجسم `400`). وملفُّ خطٍّ لكل وزنٍ **في كل مجموعة محارف** — فوزنٌ
 * ميّتٌ ملفّان يتسابقان على عرضِ نطاقٍ مخنوق.
 *
 * وثمنُه ليس بايتاتٍ فحسب: مع `swap` يُرسم النصُّ بالخطّ الاحتياطيّ
 * ثم يُعاد رسمُه حين يصل الأصليّ — **فيُسجّل المتصفّحُ LCP جديداً عند
 * التبديل**. وقِيس: FCP ٠٫٩ ثانية وLCP ٣٫٨، و٨٨٪ منها «تأخُّرُ رسم»
 * بزمنِ تحميلٍ صفر — أي أن التأخّرَ في التبديل لا في التنزيل.
 */
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-arabic",
  fallback: ["system-ui", "Segoe UI", "Tahoma", "Arial"],
})

export function generateStaticParams() {
  return [{ locale: "ar" }, { locale: "en" }]
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const l: Locale = isLocale(locale) ? locale : "ar"
  return {
    title: `${t(l, "site.name")} — ${t(l, "site.tagline")}`,
    description: t(l, "site.description"),
    // ولكلِّ لغةٍ نسختُها المعلَنة — فمحرّكُ البحث يعرض للعربيّ عربيّه.
    alternates: {
      languages: { ar: "/ar", en: "/en" },
    },
  }
}

export const viewport: Viewport = {
  themeColor: "#f9f8f4",
  colorScheme: "light",
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  // ⚠️ **ولغةٌ لا نعرفها ٤٠٤ لا رجوعٌ صامتٌ إلى العربية.** `/fr/cart`
  // التي تعرض العربيةَ تبدو ترجمةً فاشلةً لا مساراً خاطئاً، ويظنّ
  // الزائرُ أن المتجرَ فرنسيٌّ معطوب.
  if (!isLocale(locale)) notFound()

  return (
    <html lang={locale} dir={dirOf(locale)} className={`${plexArabic.variable} bg-background`}>
      <body className="font-sans antialiased">
        <div className="flex min-h-dvh flex-col">
          <SiteHeader locale={locale} />
          <main className="flex-1">{children}</main>
          <SiteFooter locale={locale} />
        </div>
      </body>
    </html>
  )
}
