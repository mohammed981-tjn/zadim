import type { Metadata, Viewport } from "next"
import { notFound } from "next/navigation"
import { IBM_Plex_Sans_Arabic } from "next/font/google"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ServiceWorker } from "@/components/service-worker"
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
    // ⚠️ أيقونةُ iOS **لا يُولّدها البيانُ**: نظامُ آبل لا يقرأ
    // `manifest.webmanifest` أصلاً، ويأخذ أيقونةَ الشاشةِ الرئيسية من
    // هذه الوسمة وحدَها. وبلا سطرها يقتطع iOS **لقطةً من الصفحة**
    // ويضعها أيقونةً — وهي في متجرٍ لقطةُ رفٍّ لا علامة.
    icons: {
      apple: "/icons/apple-touch-icon.png",
    },
    appleWebApp: {
      capable: true,
      title: t(l, "site.name"),
      statusBarStyle: "default",
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
        <ServiceWorker />
        <div className="flex min-h-dvh flex-col">
          {/*
            تخطّي الترويسة — أوّلُ ما يقع عليه Tab، ولا يُرى حتى يُركَّز.

            ── ولماذا يلزم وقد مرّ axe بلا مخالفة ──────────────────

            قاعدةُ `bypass` في axe تُرضيها معالمُ الصفحة (`main`)، وهي
            موجودة. لكنّ المعالمَ تخدم قارئَ الشاشة وحدَه: من يتنقّل
            بلوحة المفاتيح **ولا يستعمل قارئاً** — إصابةُ يدٍ، أو رعشةٌ،
            أو فأرةٌ معطّلة — يمرّ على الشعار والبحث والسلّة والحساب
            ومبدّلِ اللغة **في كل صفحةٍ يفتحها**، خمسَ ضغطاتٍ قبل أوّل
            منتج. فالفحصُ الآليّ لا يُغني عن المشي بلوحة المفاتيح.

            و`sr-only` لا `hidden`: المخفيُّ بـ`display:none` لا يُركَّز
            عليه أصلاً، فيصير الرابطُ حبراً.
          */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
          >
            {t(locale, "a11y.skipToContent")}
          </a>
          <SiteHeader locale={locale} />
          {/*
            ⚠️ و`tabIndex={-1}` ليست زينة: الانتقالُ إلى معلمٍ غيرِ
            قابلٍ للتركيز يحرّك شريطَ التمرير **ولا يحرّك التركيز** —
            فتُضغط Tab بعده فيعود إلى الترويسة من أوّلها. فالرابطُ يبدو
            عاملاً وهو لا يعمل.
          */}
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          <SiteFooter locale={locale} />
        </div>
      </body>
    </html>
  )
}
