import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * **صفرُ أجرةِ شحنٍ في الكود** — أوّلُ بنودِ بوّابة المرحلة ٧.
 *
 * ── لماذا فحصٌ آليّ لا مراجعةٌ بشرية ────────────────────────────
 *
 * رقمُ الشحن يتسلّل بسهولة: «مؤقّتاً حتى نبني الشاشة»، ثم يبقى سنةً،
 * ثم يُنسخ إلى مسارٍ ثانٍ. وحين يريد المديرُ رفعَ الأجرة عشرةَ ريالات
 * يكتشف أنها في أربعة مواضعَ لا واحد، وأن تغييرَها **نشرةُ كود**.
 *
 * فالفحصُ يمرّ على الكود الحيّ في كل دفعة.
 *
 * ── وما يُستثنى، ولماذا يُعلن الاستثناء ────────────────────────
 *
 * `src/scripts/` مستثنى: البذورُ والبوّاباتُ تكتب أرقاماً لتصنع حالةً
 * تُفحص (خيارُ شحنٍ بـ٢٥٠٠ هللة في بذرة التطوير). وهي **لا تعمل في
 * الإنتاج** ولا تقرأ منها المتاجر. والاستثناءُ معلَنٌ هنا لا مطويٌّ في
 * تعبيرٍ نمطيّ — استثناءٌ صامتٌ يجعل الفحصَ يمرّ على ما يجب أن يوقفه.
 *
 * والتعليقاتُ تُنزع قبل الفحص: رقمٌ في شرحٍ ليس أجرةً، وفحصٌ يشتكي من
 * التعليقات يُعلّم الناسَ ألّا يشرحوا.
 */

const ROOTS = ["src/modules", "src/api"];
const SKIP_DIRS = new Set(["node_modules", "migrations", ".medusa"]);

/** كلماتُ الشحن — بالعربية والإنجليزية. */
const SHIPPING_WORDS =
  /(shipping|freight|delivery|courier|carrier|شحن|توصيل|أجرة|اجره)/i;

/** رقمٌ من رقمين فأكثر: هللاتُ الشحن لا تقلّ عن ذلك عملياً. */
const AMOUNT = /(?<![\w.])\d{2,}(?![\w.])/;

/** ما لا يُعدّ مبلغاً وإن جاور كلمةَ شحن. */
const HARMLESS =
  /(status|code|http|timeout|limit|take|skip|index|length|version|20\d\d|utf-8|base64)/i;

export type RateFinding = { file: string; line: number; text: string };

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir) as unknown as string[];
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js)$/.test(name)) out.push(full);
  }
  return out;
}

export function auditShippingRates(root = process.cwd()): RateFinding[] {
  const findings: RateFinding[] = [];

  for (const rel of ROOTS) {
    for (const file of walk(join(root, rel))) {
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (!SHIPPING_WORDS.test(line)) return;
        if (!AMOUNT.test(line)) return;
        if (HARMLESS.test(line)) return;
        findings.push({
          file: file.slice(root.length + 1),
          line: i + 1,
          text: line.trim().slice(0, 120),
        });
      });
    }
  }

  return findings;
}

/**
 * هل يُبلَّغ عن هذا السطر؟ — **شاهدٌ موجبٌ للفحص نفسِه**.
 *
 * فحصٌ يُعيد «صفرَ مخالفات» قد يكون سليماً وقد يكون **أعمى**، ولا فرقَ
 * في مخرَجه. فالبوّابةُ تمرّر عليه سطوراً تحوي أجرةً صريحةً وتتوقّع أن
 * يمسكها، وأخرى بريئةً وتتوقّع أن يتركها. وبلا ذلك لا يُعرف أيُّهما.
 */
export function wouldFlag(line: string): boolean {
  const clean = stripComments(line);
  return SHIPPING_WORDS.test(clean) && AMOUNT.test(clean) && !HARMLESS.test(clean);
}
