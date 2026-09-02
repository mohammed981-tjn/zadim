/**
 * Money handling for زادم.
 *
 * The API speaks in INTEGER HALALAS: 32545 === 325.45 ر.س.
 * We never divide by 100 into a binary float. All arithmetic is integer,
 * and the fractional part is produced with string padding.
 */

const WESTERN_TO_ARABIC: Record<string, string> = {
  "0": "٠",
  "1": "١",
  "2": "٢",
  "3": "٣",
  "4": "٤",
  "5": "٥",
  "6": "٦",
  "7": "٧",
  "8": "٨",
  "9": "٩",
  ".": "٫", // Arabic decimal separator (U+066B)
  ",": "٬", // Arabic thousands separator (U+066C)
}

/** Convert a western-digit string to Arabic-Indic digits and separators. */
export function toArabicDigits(input: string): string {
  let out = ""
  for (const ch of input) out += WESTERN_TO_ARABIC[ch] ?? ch
  return out
}

/**
 * 🔴 **الرقمُ يتبع اللغة** — وهذا ليس تجميلاً.
 *
 * صفحةٌ إنجليزيةٌ سعرُها «٣٩٩٫٠٠ ر.س» ليست إنجليزية: الزائرُ الذي لا
 * يقرأ العربيةَ **لا يعرف كم يدفع**. وهو أخطرُ موضعٍ يبقى فيه شيءٌ
 * غيرَ مترجَم، لأن بقيةَ الصفحة تبدو سليمةً فيثق بها.
 *
 * وقد كان كلُّ ما هنا مبرمَجاً بالعربية، **وأمسكته بوّابةُ الواجهة**
 * حين صارت تقرأ نصَّ الصفحة بلغتها.
 *
 * والفاصلةُ العشرية تختلف كذلك: `٫` (U+066B) عربيةً و`.` إنجليزيةً.
 */
export type MoneyLocale = "ar" | "en"

/** الأرقامُ بلغتها: عربيةً-هنديةً في العربية، وكما هي في الإنجليزية. */
export function digits(locale: MoneyLocale, input: string | number): string {
  const s = String(input)
  return locale === "ar" ? toArabicDigits(s) : s
}

/**
 * Format integer halalas WITHOUT the currency label. Pure integer math — no
 * float ever touches the value.
 *
 * formatHalalas(32545, "ar") -> "٣٢٥٫٤٥"
 * formatHalalas(32545, "en") -> "325.45"
 */
export function formatHalalas(halalas: number, locale: MoneyLocale): string {
  const value = Math.trunc(halalas)
  const negative = value < 0
  const abs = Math.abs(value)

  const riyals = Math.floor(abs / 100)
  const fraction = String(abs % 100).padStart(2, "0")

  // Group the integer part in thousands with western commas, then translate.
  const grouped = riyals.toLocaleString("en-US")
  const western = `${grouped}.${fraction}`

  // `؜` (U+061C) قبل السالب في العربية وحدَها: بدونه يقفز سطرُ
  // الخصم إلى الجهة الخطأ في نصٍّ من اليمين إلى اليسار.
  const sign = negative ? (locale === "ar" ? "؜-" : "-") : ""
  return `${sign}${digits(locale, western)}`
}

/**
 * اسمُ العملة.
 *
 * و«SAR» لا «SR» ولا «﷼»: الأوّلُ رمزُ ISO يعرفه كلُّ من تعامل مع
 * تحويلٍ بنكيّ، والثاني اختصارٌ غيرُ قياسيّ، والثالثُ محرفٌ لا تعرضه
 * كثيرٌ من الخطوط فيظهر مربّعاً فارغاً مكانَ العملة.
 */
export function sarLabel(locale: MoneyLocale): string {
  return locale === "ar" ? "ر.س" : "SAR"
}

/** Full display string, e.g. "٣٢٥٫٤٥ ر.س" / "325.45 SAR". */
export function formatMoney(halalas: number, locale: MoneyLocale): string {
  return `${formatHalalas(halalas, locale)} ${sarLabel(locale)}`
}
