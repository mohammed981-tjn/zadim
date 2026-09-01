import { ar } from "./ar";
import { en } from "./en";

/**
 * اللغتان — **قاموسان مسطَّحان ودالّةُ بحثٍ واحدة**.
 *
 * ── ولماذا لا مكتبةَ ترجمة ───────────────────────────────────────
 *
 * مكتباتُ i18n تحمل تحميلاً كسولاً وتصريفَ جمعٍ وتنسيقَ تواريخَ لاثنتي
 * عشرةَ لغة. ونحن لغتان ونصوصٌ معدودة، والنصُّ الذي يتغيّر (المنتجات)
 * ليس هنا أصلاً بل في القاعدة. فالمكتبةُ حزمةٌ تُحمَّل في المتصفّح لأجل
 * ما يفعله كائنٌ واحد.
 *
 * ── والمفتاحُ المفقود يُقال ولا يُخفى ───────────────────────────
 *
 * `t("nope")` تُعيد المفتاحَ نفسَه ظاهراً — فيراه من يطوّر ويصلحه،
 * **وتمسكه بوّابةُ المتصفّح** إن وصل إلى شاشة. والبديلُ (فراغٌ صامت)
 * يجعل زرّاً بلا نصٍّ يبدو تصميماً.
 */
export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ar";

const DICTS: Record<Locale, Record<string, string>> = { ar, en };

export function isLocale(v: string | undefined): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

/** اتجاهُ الكتابة — **من اللغة لا من ثابتٍ في الجذر**. */
export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
  // العربيةُ مرجعٌ حين تنقص الإنجليزية: نصٌّ بلغةٍ أخرى أوضحُ من مفتاحٍ
  // خام. والمفقودُ من الاثنتين يظهر بمفتاحه ليُصلَح.
  const raw = dict[key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** مُترجِمٌ مربوطٌ بلغةٍ — يُمرَّر إلى المكوّنات. */
export function translator(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => t(locale, key, vars);
}

/** يبدّل لغةَ مسارٍ ويحفظ بقيّتَه — «/ar/cart» ⇄ «/en/cart». */
export function switchLocalePath(pathname: string, to: Locale): string {
  const parts = pathname.split("/").filter(Boolean);
  if (isLocale(parts[0])) parts[0] = to;
  else parts.unshift(to);
  return "/" + parts.join("/");
}
