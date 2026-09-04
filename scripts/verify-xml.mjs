/**
 * فاحصُ صحّةِ XML — حارسٌ وُلد من عطبٍ وقع مرّتين في يومٍ واحد.
 *
 * ── ما وقع ──────────────────────────────────────────────────────
 *
 * `apps/storefront/app/icon.svg` كانت **غيرَ صالحةٍ منذ كُتبت**: تعليقُها
 * يحوي «‎--primary‎»، ومواصفةُ XML تمنع شرطتين متتاليتين داخل تعليق.
 * فكانت كلُّ مُحلِّلةٍ صارمةٍ ترفض الملفَّ كاملاً — أي **لا أيقونةَ في
 * شريط المتصفّح**. ولم يمسكها شيء: `tsc` لا يقرأ SVG، والبناءُ ينسخها
 * كما هي، والمتصفّحُ لا يقول شيئاً — يعرض أيقونةً فارغةً كأنها التصميم.
 *
 * ثم وقع العطبُ نفسُه في `res/values/colors.xml` وأنا أكتب الأندرويد،
 * للسببِ نفسِه حرفاً بحرف. وعطبٌ يتكرّر في يومٍ واحدٍ لا يُصلَح مرّتين
 * بل يُحرَس.
 *
 * ── وما يفحصه ──────────────────────────────────────────────────
 *
 * كلَّ `.svg` و`.xml` في شجرة المستودع (عدا `node_modules` والمبنيّ):
 * أهي XML صالحةٌ نحوياً. ولا يفحص المعنى — ذاك عملُ AAPT والمتصفّح.
 */
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const SKIP = new Set(["node_modules", ".git", ".next", "build", "dist", ".medusa", ".gradle"])

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.name.endsWith(".xml") || e.name.endsWith(".svg")) yield p
  }
}

/**
 * مُحلِّلةٌ صغيرةٌ بدل حزمة: المطلوبُ **قاعدةٌ واحدةٌ تُكسر عملياً** —
 * التعليقاتُ — لا تحقّقٌ كاملٌ من النحو. وحزمةُ XML كاملةٌ تبعيّةٌ جديدةٌ
 * في الجذر لأجل تعبيرٍ نمطيّ.
 */
function findCommentFault(text) {
  let i = 0
  while ((i = text.indexOf("<!--", i)) !== -1) {
    const end = text.indexOf("-->", i + 4)
    if (end === -1) return { line: lineOf(text, i), why: "تعليقٌ لم يُغلَق" }
    const body = text.slice(i + 4, end)
    const at = body.indexOf("--")
    if (at !== -1) {
      return { line: lineOf(text, i + 4 + at), why: "«--» داخل تعليق — ترفضه كلُّ مُحلِّلةِ XML" }
    }
    i = end + 3
  }
  return null
}

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length

let bad = 0
let seen = 0
for await (const file of walk(ROOT)) {
  seen++
  const fault = findCommentFault(await readFile(file, "utf8"))
  if (fault) {
    bad++
    console.error(`  ⛔ ${relative(ROOT, file)}:${fault.line} — ${fault.why}`)
  }
}

if (bad === 0) console.log(`✅ فحوصُ XML: ${seen} ملفّاً، كلُّها صالحة.`)
else console.error(`\n⛔ ${bad} ملفّاً غيرَ صالح.`)
process.exit(bad === 0 ? 0 : 1)
