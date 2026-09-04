import type { MetadataRoute } from "next"
import { t } from "@/lib/i18n"

/**
 * بيانُ التطبيق — **بالعربية، ولغةً واحدة**.
 *
 * ── لماذا واحدٌ لا واحدٌ لكلّ لغة ───────────────────────────────
 *
 * المواصفةُ تسمح ببيانٍ واحدٍ لكلّ نطاق: النظامُ يقرأه **مرّةً عند
 * التثبيت** ويحفظ اسمَه وأيقونتَه في مُشغّل التطبيقات. فلا معنى لبيانٍ
 * يتغيّر بلغةِ الصفحةِ التي ثُبّت منها — الاسمُ المحفوظ لا يُترجَم بعدها.
 *
 * والجمهورُ سعوديّ (`DEFAULT_LOCALE = "ar"` في `proxy.ts` لسبب مكتوبٍ
 * هناك)، فالاسمُ عربيٌّ و`start_url` عربيّ. ومن ثبّته من الإنجليزية
 * يفتح `/ar` ثم يبدّل بزرّ اللغة — وهو أهونُ من عربيٍّ يُفتح له
 * إنجليزيّ.
 *
 * ── و`scope: "/"` لا `/ar` ──────────────────────────────────────
 *
 * لأن زرَّ اللغة ينقل إلى `/en/…`، ونطاقٌ مقصورٌ على `/ar` يجعل التبديلَ
 * يقذف الزائرَ **خارج التطبيق إلى المتصفّح** — فيبدو أن التطبيق انهار.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${t("ar", "site.name")} — ${t("ar", "site.tagline")}`,
    short_name: t("ar", "site.name"),
    description: t("ar", "site.description"),
    lang: "ar",
    dir: "rtl",
    id: "/ar",
    start_url: "/ar",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    categories: ["shopping"],
    // ولونُ الخلفية لونُ `--background` نفسُه: شاشةُ الإقلاع تُرسم به قبل
    // أن يصل أيُّ CSS، فلونٌ مخالفٌ ومضةٌ بيضاءُ في كلّ فتحة.
    background_color: "#f9f8f4",
    theme_color: "#f9f8f4",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // ⚠️ و`maskable` **صفٌّ منفصل** لا `purpose: "any maskable"`: أيقونةٌ
      // بالغرضين تُعرض كاملةً حيث لا قصَّ فتبدو صغيرةً في إطارٍ فارغ.
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: t("ar", "cart.title"), url: "/ar/cart" },
      { name: t("ar", "search.prompt"), url: "/ar/search" },
    ],
  }
}
