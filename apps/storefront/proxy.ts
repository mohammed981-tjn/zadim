import { NextResponse, type NextRequest } from "next/server"
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n"

/**
 * زائرٌ يفتح `/` أو `/cart` بلا لغةٍ يُحوَّل إلى لغته.
 *
 * ── ولماذا لا تُترك المسارات بلا لغةٍ أصلاً ─────────────────────
 *
 * لأن الصفحةَ الواحدةَ بعنوانين (`/cart` و`/ar/cart`) محتوىً مكرَّرٌ
 * لمحرّكات البحث، ورابطٌ يُشارَك لا يحمل لغةَ مُشارِكه. فلكلِّ لغةٍ
 * عنوانُها، ولا عنوانَ بلا لغة.
 *
 * ── واسمُه `proxy` لا `middleware` ─────────────────────────────
 *
 * اصطلاحُ `middleware` مهجورٌ في Next 16 ويُحذّر منه البناءُ صراحةً.
 * والتحذيرُ اليومَ خطأٌ غداً — واصطلاحٌ مهجورٌ في ملفٍّ يحرس **كلَّ**
 * مسارٍ في المتجر ليس مكانَ المخاطرة.
 *
 * ⚠️ **والافتراضُ العربية** لا لغةُ المتصفّح وحدَها: الجمهورُ سعوديّ،
 * ومتصفّحٌ إنجليزيُّ الإعدادِ في الرياض أمرٌ شائع. فتُقرأ رغبةُ الزائر
 * إن صرّح بها (`Accept-Language` يبدأ بـ`en`)، وإلا فالعربية.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) {
    return NextResponse.next()
  }

  const accept = req.headers.get("accept-language") ?? ""
  const wantsEnglish = /^\s*en\b/i.test(accept)
  const locale = wantsEnglish ? "en" : DEFAULT_LOCALE

  const url = req.nextUrl.clone()
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`
  return NextResponse.redirect(url)
}

export const config = {
  /**
   * كلُّ شيءٍ عدا ملفّات Next نفسِها وأصولِ الموقع.
   *
   * ⚠️ **وثلاثةُ ملفّاتٍ تسقط بصمتٍ إن لم تُستثنَ** — أُضيفت مع طبقة
   * التطبيق: بيانُ التطبيق وعاملُ الخدمة وروابطُ الأصول الرقمية. فلا
   * امتدادَ لأوّلها في القائمة أدناه، والثاني `.js` والثالث `.json`
   * تحت `‎.well-known/‎`. وبلا استثنائها يردّ هذا الملفُّ **تحويلاً إلى
   * `/ar/…`** بدل الملفّ:
   *
   *   · بيانٌ لا يُقرأ ⇒ لا يُعرض «تثبيتُ التطبيق» إطلاقاً.
   *   · عاملٌ يردّ HTML بنوع `text/html` ⇒ يرفضه المتصفّح ولا يُسجَّل.
   *   · روابطُ أصولٍ لا تُقرأ ⇒ يظهر **شريطُ عنوانٍ فوق التطبيق**.
   *
   * وثلاثتُها تفشل بلا خطأٍ في سجلٍّ ولا حمرةٍ في بناء. فاستثناؤها
   * صريحٌ ومشروحٌ لئلا يُختصر في تنظيفٍ لاحق.
   */
  matcher: [
    "/((?!_next|api|\\.well-known|manifest\\.webmanifest|sw\\.js|offline\\.html|favicon|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt|xml|json|js|webmanifest|html)).*)",
  ],
}
