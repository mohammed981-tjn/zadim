/**
 * مولّدُ أصولِ العلامة — واحدٌ لموقعِ الويب ولتطبيقِ أندرويد.
 *
 * ── لماذا مولّدٌ ملتزَمٌ ومخرجاتُه ملتزَمة ─────────────────────────
 *
 * الأيقوناتُ ملفّاتٌ ثنائية: لا يُقرأ فرقُها في مراجعةٍ ولا يُعرف من
 * نظر إليها لماذا هي كذلك. فيُلتزم **المصدرُ والمخرجُ معاً**: المصدرُ
 * يشرح القرار، والمخرجُ يجعل البناءَ لا يحتاج `sharp` ولا خطوطاً ولا
 * شبكة — وهو شرطٌ عمليّ، فبناءُ Vercel وبناءُ أندرويد كلاهما لا يملك
 * أدواتِ الرسم هذه.
 *
 * ولا يُشغَّل هذا الملفُّ في CI بقصد: تشغيلُه في كلّ بناءٍ يعني بايتاتٍ
 * مختلفةً بين إصداري `sharp`، فيتغيّر توقيعُ الأصولِ بلا تغييرٍ في
 * العلامة.
 *
 *   npm i && npm run gen
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { iconSvg, vectorDrawable, BRAND } from "./glyph.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../..")
const WEB = resolve(repo, "apps/storefront/public/icons")
const RES = resolve(repo, "apps/android/app/src/main/res")

/** يرسم SVG إلى PNG بكثافةٍ عاليةٍ ثم يُصغّر — فالحوافُّ المنحنية لا تُسنَّن. */
async function png(svg, size, out) {
  await mkdir(dirname(out), { recursive: true })
  await sharp(Buffer.from(svg), { density: 1200 })
    .resize(size, size, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(out)
  return `${out.replace(repo + "/", "")} (${size}px)`
}

const made = []

// ── الويب ────────────────────────────────────────────────────────────
// `any`: مربّعٌ مستديرُ الأركان، يُعرض كما هو.
const anyIcon = iconSvg({ radius: 14, coverage: 0.78 })
// `maskable`: مربّعٌ حادٌّ مملوءٌ إلى الحافّة والحرفُ داخل الدائرةِ الآمنة.
// وتغطيةُ ٠٫٥٦ تُبقيه داخل ٨٠٪ حتى مع أقسى قاصّةٍ دائرية.
const maskIcon = iconSvg({ radius: 0, coverage: 0.56 })

for (const size of [192, 512]) {
  made.push(await png(anyIcon, size, `${WEB}/icon-${size}.png`))
  made.push(await png(maskIcon, size, `${WEB}/icon-maskable-${size}.png`))
}
// أيقونةُ iOS: بلا شفافيةٍ وبلا أركانٍ مستديرة — iOS يستدير بنفسه، وأركانُنا
// فوق أركانِه تُنتج حافّةً مزدوجة.
made.push(await png(iconSvg({ radius: 0, coverage: 0.72 }), 180, `${WEB}/apple-touch-icon.png`))

// ── أندرويد: mipmaps للأجهزة قبل API 26 ─────────────────────────────
// وما بعدَها يقرأ الأيقونةَ المتكيّفة (`mipmap-anydpi-v26`) وهي متجهاتٌ
// لا صور — انظر `ic_launcher.xml`.
const DPI = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
for (const [bucket, size] of Object.entries(DPI)) {
  made.push(await png(anyIcon, size, `${RES}/mipmap-${bucket}/ic_launcher.png`))
  made.push(await png(iconSvg({ radius: 32, coverage: 0.7 }), size, `${RES}/mipmap-${bucket}/ic_launcher_round.png`))
}

// ── أندرويد: صورةُ شاشة الإقلاع ─────────────────────────────────────
//
// 🔴 **صورةٌ نقطيّةٌ لا متجه — وهذا قرارٌ لا تفضيل.**
//
// خلفيّةُ النافذة (`android:windowBackground`) يُنفلتها النظامُ **قبل
// أن يُنشأ النشاط**، بمُحمِّلِ مواردَ لا يمرّ بطبقة التوافق. ومتجهٌ
// داخل `layer-list` هناك نمطٌ غيرُ مضمونٍ عبر الإصدارات: ينفلت على
// جهازٍ ويرمي `InflateException` على آخر — **فينهار التطبيقُ قبل أن
// يرسم إطاراً**، وهو ما لا يُميَّز عن أيّ انهيارِ إقلاعٍ آخر.
//
// وBubblewrap — وهو المولّدُ المرجعيُّ لتطبيقات TWA — يستعمل صورةً
// نقطيّةً هنا. فلا سببَ للمخالفة.
made.push(await png(iconSvg({ radius: 28, coverage: 0.7 }), 512, `${RES}/drawable/splash_mark.png`))

// ── أندرويد: المتجهات ───────────────────────────────────────────────
async function xml(out, body) {
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, body)
  return out.replace(repo + "/", "")
}

// مقدّمةُ الأيقونة المتكيّفة: لوحةُ ١٠٨، والحبرُ داخل الـ٧٢ الوسطى —
// فالمُشغّلُ يقتطع الحوافَّ ويحرّك المقدّمةَ عند الرجّ (parallax).
made.push(await xml(`${RES}/drawable/ic_launcher_foreground.xml`,
  vectorDrawable({ size: 108, box: 62, color: BRAND.cream, dp: 108 })))

// علامةُ شاشة الإقلاع: خضراءُ على الخلفية الكريمية نفسِها التي يرسمها
// البيانُ (`background_color`) — فلا ومضةَ لونٍ بين الشاشتين.
made.push(await xml(`${RES}/drawable/ic_zadim_mark.xml`,
  vectorDrawable({ size: 64, box: 52, color: BRAND.green, dp: 132 })))

// ── أيقونةُ المتصفّح (favicon) ───────────────────────────────────────
// تُكتب SVGاً لأن الشريطَ يعرضها بأيّ مقاس، **وتُفحص أنها XML صالح**:
// كانت السابقةُ تحوي «--» داخل تعليقٍ فترفضها كلُّ مُحلِّلةٍ صارمة.
const favicon = `<?xml version="1.0" encoding="UTF-8"?>\n${iconSvg({ radius: 14, coverage: 0.78 })}\n`
await writeFile(resolve(repo, "apps/storefront/app/icon.svg"), favicon)
await sharp(Buffer.from(favicon)).png().toBuffer() // ينفجر إن لم تكن XML صالحة
made.push("apps/storefront/app/icon.svg (متجه — وقد حُلِّل)")

console.log(`لونُ العلامة ${BRAND.green} · الخلفية ${BRAND.theme}`)
for (const m of made) console.log("  ✅", m)
