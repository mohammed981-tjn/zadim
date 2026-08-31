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
 * Format integer halalas as an Arabic-Indic amount string WITHOUT the currency
 * symbol. Pure integer math — no float ever touches the value.
 *
 * formatHalalas(32545) -> "٣٬٢٥٤٫٤٥"
 * formatHalalas(500)   -> "٥٫٠٠"
 */
export function formatHalalas(halalas: number): string {
  const value = Math.trunc(halalas)
  const negative = value < 0
  const abs = Math.abs(value)

  const riyals = Math.floor(abs / 100)
  const fraction = String(abs % 100).padStart(2, "0")

  // Group the integer part in thousands with western commas, then translate.
  const grouped = riyals.toLocaleString("en-US")
  const western = `${grouped}.${fraction}`

  return `${negative ? "؜-" : ""}${toArabicDigits(western)}`
}

/** The Saudi Riyal label shown after the number. */
export const SAR = "ر.س"

/** Full display string, e.g. "٣٬٢٥٤٫٤٥ ر.س". */
export function formatMoney(halalas: number): string {
  return `${formatHalalas(halalas)} ${SAR}`
}
