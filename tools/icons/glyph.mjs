/**
 * حرفُ «ز» — أوّلُ «زادم» — **مرسوماً مساراً لا نصّاً**.
 *
 * ── لماذا مسارٌ لا `<text>` ────────────────────────────────────────
 *
 * كانت `app/icon.svg` ترسم الحرفَ بـ`<text>` معتمدةً على خطٍّ عربيّ في
 * جهاز القارئ. وهذا يعمل في متصفّحٍ سطحيّ ويسقط في كلّ مكانٍ آخر:
 * مولّدُ أيقوناتٍ على خادمِ بناءٍ بلا خطوطٍ عربية يُخرج **مربّعاً
 * أخضرَ فارغاً**، وسقوطُه صامتٌ — الملفُّ يُكتب والبناءُ يخضرّ
 * والأيقونةُ بلا حرف. (وقد قيس هنا: `fc-list | grep -i arab` = صفر.)
 *
 * فالحرفُ هندسةٌ لا محرفٌ: يُرسم حيثما رُسم، بلا خطٍّ ولا شبكةٍ ولا ظنّ.
 */

/** حدودُ الحبر في مربّع 64 — محسوبةٌ من المسار ونصفِ عرضِ القلم (٤). */
export const INK = { x0: 12, y0: 8.7, x1: 49, y1: 57.5 }

export const BRAND = {
  /** `--primary` في `globals.css`: oklch(0.46 0.078 158) */
  green: "#2c6547",
  /** `--primary-foreground`: oklch(0.98 0.008 95) */
  cream: "#faf8f3",
  /** `themeColor` المعلَنُ في `app/[locale]/layout.tsx` */
  theme: "#f9f8f4",
}

/** جسمُ الحرف وحدَه، بلا خلفية، في مربّع 64. */
export function glyphPaths(fill = BRAND.cream) {
  return `<path d="M45 24 C45 34 41.5 42 35 47.5 C29.5 52 23 53.5 16 53.5"
        fill="none" stroke="${fill}" stroke-width="8"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="42" cy="12.5" r="3.8" fill="${fill}"/>`
}

/**
 * الحرفُ موسَّطاً بصرياً ومقيَّساً ليملأ نسبةً من المربّع.
 *
 * و`coverage` هو الفرق بين أيقونةٍ عادية وأخرى «قابلةٍ للقصّ»: القاصّةُ
 * تقتطع ما خرج عن دائرةٍ قطرُها ٨٠٪ من الضلع، فتأكل ذيلَ الحرف. فتُولَّد
 * نسختان بنسبتين، لا نسخةٌ واحدةٌ يُراهَن على نجاتها.
 */
export function centeredGlyph(coverage) {
  const w = INK.x1 - INK.x0
  const h = INK.y1 - INK.y0
  const s = (64 * coverage) / Math.max(w, h)
  const cx = (INK.x0 + INK.x1) / 2
  const cy = (INK.y0 + INK.y1) / 2
  const tx = 32 - s * cx
  const ty = 32 - s * cy
  return `<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(5)})">${glyphPaths()}</g>`
}

/** أيقونةٌ كاملةٌ: خلفيةٌ + حرف. `radius` بوحدات المربّع ٦٤ (٠ = مربّعٌ حادّ). */
export function iconSvg({ radius = 14, coverage = 0.78, bg = BRAND.green } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="${radius}" fill="${bg}"/>
  ${centeredGlyph(coverage)}
</svg>`
}

/**
 * الحرفُ نفسُه **متجهاً لأندرويد** — بإحداثياتٍ محسوبةٍ لا محوَّلةٍ بمجموعة.
 *
 * ── لماذا تُحسب النقاط ولا يُستعمل `<group>` ──────────────────────
 *
 * `VectorDrawable` يطبّق تحويلَ المجموعة بترتيبٍ (محور، تدوير، تكبير،
 * ثم إزاحة) يخالف حدسَ من يقرأ SVG، **ولا يُكبّر `strokeWidth` معه على
 * كلّ إصدار**. فحرفٌ يبدو صحيحاً في معاينة الأستوديو يخرج بقلمٍ رفيعٍ
 * على جهاز. فتُطبَّق المصفوفةُ هنا مرّةً، ويخرج المتجهُ بإحداثياتٍ نهائية.
 *
 * @param size ضلعُ اللوحة (٦٤ للأيقونة، ١٠٨ للمتكيّفة)
 * @param box  ضلعُ المربّع الذي يجب أن يقع الحبرُ داخله
 * @param color لونُ الحبر
 */
export function vectorDrawable({ size, box, color, dp = size }) {
  const w = INK.x1 - INK.x0
  const h = INK.y1 - INK.y0
  const s = box / Math.max(w, h)
  const c = size / 2
  const tx = c - s * ((INK.x0 + INK.x1) / 2)
  const ty = c - s * ((INK.y0 + INK.y1) / 2)
  const X = (v) => (s * v + tx).toFixed(2)
  const Y = (v) => (s * v + ty).toFixed(2)
  const r = (3.8 * s).toFixed(2)

  const stroke = `M${X(45)},${Y(24)} C${X(45)},${Y(34)} ${X(41.5)},${Y(42)} ${X(35)},${Y(47.5)} C${X(29.5)},${Y(52)} ${X(23)},${Y(53.5)} ${X(16)},${Y(53.5)}`
  // النقطةُ دائرةٌ بقوسين — `VectorDrawable` لا يعرف `<circle>`.
  const dot = `M${X(42)},${(Number(Y(12.5)) - Number(r)).toFixed(2)} a${r},${r} 0 1,1 -0.01,0 Z`

  return `<?xml version="1.0" encoding="utf-8"?>
<!-- مولَّدٌ من tools/icons — لا يُحرَّر بيدٍ، بل يُعاد توليدُه. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${dp}dp"
    android:height="${dp}dp"
    android:viewportWidth="${size}"
    android:viewportHeight="${size}">
  <path
      android:pathData="${stroke}"
      android:strokeColor="${color}"
      android:strokeWidth="${(8 * s).toFixed(2)}"
      android:strokeLineCap="round"
      android:strokeLineJoin="round" />
  <path
      android:pathData="${dot}"
      android:fillColor="${color}" />
</vector>
`
}
