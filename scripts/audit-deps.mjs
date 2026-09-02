#!/usr/bin/env node
/**
 * تدقيقُ الاعتماديات (المرحلة ١٥) — سقّاطةٌ لا بوّابةٌ مطلقة.
 *
 * ── لماذا لا `npm audit --audit-level=high` وحدَه ────────────────
 *
 * لأنه يفشل اليوم بـ٦٩ ثغرةً عاليةً **كلُّها داخل شجرة Medusa نفسِها**
 * (`@medusajs/framework` ← `lodash` وأمثالُها). ولا نملك إصلاحَها: هي
 * تُصلَح يومَ تُصدر Medusa تحديثاً.
 *
 * فورشةٌ تفشل من أوّل يومٍ ولا تستطيع أن تنجح **ليست حارساً**: هي
 * تُعلّم قارئَها أن الأحمرَ لا يعني شيئاً — ثم يمرّ الأحمرُ الحقيقيُّ
 * بينها بلا أن يراه أحد. (نفسُ مبدأ نبضة القاعدة: تُنبّه ولا تُسقط.)
 *
 * ── فالحكمُ على ثلاثة، وكلُّها ممّا نملك ─────────────────────────
 *
 * ١. **أيُّ ثغرةٍ حرجة** — أينما كانت. لا خطَّ أساسٍ لها ولا تسامح.
 * ٢. **ازديادُ العدد** عن خطّ الأساس المسجَّل — سقّاطةٌ لا تُرفع.
 *    فحزمةٌ جديدةٌ تجرّ ثغرةً تُوقف الدفعة، وشجرةُ Medusa الثابتة لا.
 * ٣. **ثغرةٌ في اعتماديةٍ مباشرةٍ ليست من Medusa** — تلك اخترناها نحن
 *    ونستطيع تبديلَها، فلا عذر.
 *
 * وخطُّ الأساس يُخفَّض ولا يُرفع: `node scripts/audit-deps.mjs --update`
 * تكتبه، ويُراجَع في الدفعة كأيّ سطرٍ آخر.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "docs", "security-baseline.json");
const APPS = ["apps/backend", "apps/storefront"];

/** ما لا نملك إصلاحه: شجرةُ Medusa. تُستثنى من الشرط ٣ لا من ١ و٢. */
const UPSTREAM = /^@medusajs\//;

/**
 * الحكمُ على تقريرٍ واحد. مفصولٌ عن `npm` عمداً كي يُختبر ببيانات
 * مصطنَعة — فاحصٌ لا يُختبر إلا على الحال السليمة لا يُعرف أعمى هو أم لا.
 */
export function judge(app, report, base) {
  const failures = [];
  const notes = [];

  const meta = report?.metadata?.vulnerabilities ?? {};
  const vulns = report?.vulnerabilities ?? {};
  const counts = {
    critical: meta.critical ?? 0,
    high: meta.high ?? 0,
    moderate: meta.moderate ?? 0,
    low: meta.low ?? 0,
  };

  // ١) الحرجة — بلا تسامح.
  const criticals = Object.entries(vulns)
    .filter(([, v]) => v.severity === "critical")
    .map(([n]) => n);
  if (criticals.length) {
    failures.push(`${app}: ثغرةٌ حرجة — ${criticals.join(" · ")}`);
  }

  // ٢) السقّاطة.
  for (const level of ["high", "moderate"]) {
    const allowed = base?.[level] ?? 0;
    if (counts[level] > allowed) {
      failures.push(
        `${app}: ${level} صار ${counts[level]} وخطُّ الأساس ${allowed} — دفعةٌ أضافت ثغرة`
      );
    } else if (counts[level] < allowed) {
      notes.push(`${app}: ${level} انخفض ${allowed} ⇐ ${counts[level]} — اخفض خطَّ الأساس`);
    }
  }

  // ٣) مباشرةٌ ليست من Medusa.
  const ours = Object.entries(vulns)
    .filter(([n, v]) => v.isDirect && !UPSTREAM.test(n))
    .map(([n, v]) => `${n} [${v.severity}]`);
  if (ours.length) {
    failures.push(`${app}: ثغرةٌ في اعتماديةٍ اخترناها نحن — ${ours.join(" · ")}`);
  }

  return { counts, failures, notes };
}

/** الشاهد الموجب: أربعُ حالاتٍ نعرف جوابَها. */
function positiveControl() {
  const errs = [];
  const base = { high: 5, moderate: 0 };

  const clean = judge("t", { metadata: { vulnerabilities: { high: 5 } }, vulnerabilities: {} }, base);
  if (clean.failures.length) errs.push("الشاهد ١: حالةٌ سليمة حُكم عليها بالفشل");

  const crit = judge("t", {
    metadata: { vulnerabilities: { critical: 1, high: 0 } },
    vulnerabilities: { boom: { severity: "critical", isDirect: false } },
  }, base);
  if (!crit.failures.length) errs.push("الشاهد ٢: ثغرةٌ حرجة مرّت");

  const grew = judge("t", { metadata: { vulnerabilities: { high: 6 } }, vulnerabilities: {} }, base);
  if (!grew.failures.length) errs.push("الشاهد ٣: ازديادٌ فوق خطّ الأساس مرّ");

  const mine = judge("t", {
    metadata: { vulnerabilities: { high: 5 } },
    vulnerabilities: { "left-pad": { severity: "high", isDirect: true } },
  }, base);
  if (!mine.failures.length) errs.push("الشاهد ٤: ثغرةٌ في اعتماديةٍ مباشرةٍ لنا مرّت");

  // ٥) وأن استثناء Medusa لا يبتلع كلَّ شيء.
  const upstream = judge("t", {
    metadata: { vulnerabilities: { high: 5 } },
    vulnerabilities: { "@medusajs/framework": { severity: "high", isDirect: true } },
  }, base);
  if (upstream.failures.length) errs.push("الشاهد ٥: ثغرةُ Medusa المباشرة أُسقطت وكان يجب تجاهلُها");

  return errs;
}

function auditOf(app) {
  try {
    // `npm audit` يخرج برمزٍ غيرِ صفريّ حين يجد شيئاً — وهو ليس فشلاً
    // هنا: الحكمُ لنا لا له. فيُقرأ المخرَجُ من الخطأ أيضاً.
    const out = execFileSync("npm", ["audit", "--json"], {
      cwd: join(ROOT, app),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (e) {
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout);
      } catch {
        /* يسقط أدناه */
      }
    }
    throw new Error(`تعذّر تدقيقُ ${app}: ${e.message}`);
  }
}

const control = positiveControl();
if (control.length) {
  for (const e of control) console.error(`  ✗ ${e}`);
  console.error("🔴 سقط الشاهدُ الموجب — الفاحصُ نفسُه معطوب.");
  process.exit(1);
}
console.log(`  ✅ الشاهد الموجب: خمسُ حالاتٍ معروفةُ الجواب مرّت`);

/**
 * خطُّ الأساس — يُقرأ مباشرةً، ولا يُسأل عن وجوده أوّلاً.
 *
 * ── ولماذا لا `existsSync` ثم `readFileSync` ────────────────────
 *
 * لأن بينهما فجوةً: الملفُّ قد يُحذف أو يُستبدل بعد السؤال وقبل
 * القراءة (CWE-367). وهو ما أمسكه **CodeQL في أوّل تشغيلةٍ له على هذا
 * المستودع** — وفي الدفعة التي ركّبته نفسِها.
 *
 * ولا يُدفع هنا ثمنٌ للتخلّص منه: `readFileSync` تخبرنا بالغياب
 * بـ`ENOENT` — سؤالٌ واحدٌ بدل سؤالين، وبلا فجوةٍ بينهما.
 *
 * وفائدةٌ ثانية أهمُّ: الشرطيّةُ القديمة كانت تخلط **الغيابَ بالفساد**.
 * وخطُّ أساسٍ فاسدُ الصياغة كان سيسقط برسالةٍ لا تقول ما بها، بينما
 * غيابُه حالٌ مشروعةٌ (أوّلُ تشغيلة). فصارا حالين لكلٍّ رسالتُه.
 */
function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new Error(
      `خطُّ الأساس موجودٌ وغيرُ صالح (${BASELINE}): ${e.message}\n` +
        `أعِد توليدَه: node scripts/audit-deps.mjs --update`
    );
  }
}

const baseline = readBaseline();
const update = process.argv.includes("--update");
const fresh = {};
let failed = 0;

for (const app of APPS) {
  const report = auditOf(app);
  const { counts, failures, notes } = judge(app, report, baseline[app]);
  fresh[app] = { high: counts.high, moderate: counts.moderate };

  console.log(
    `\n${app}: حرجة ${counts.critical} · عالية ${counts.high} · متوسطة ${counts.moderate} · منخفضة ${counts.low}`
  );
  for (const n of notes) console.log(`  ℹ️ ${n}`);
  for (const f of failures) {
    console.error(`  ✗ ${f}`);
    failed++;
  }
  if (!failures.length) console.log(`  ✅ ضمن خطّ الأساس`);
}

if (update) {
  writeFileSync(BASELINE, JSON.stringify(fresh, null, 2) + "\n");
  console.log(`\nكُتب خطُّ الأساس: ${BASELINE}`);
  process.exit(0);
}

if (failed) {
  console.error(`\n🔴 تدقيقُ الاعتماديات سقط — ${failed} بنداً.`);
  process.exit(1);
}
console.log(`\n✅ تدقيقُ الاعتماديات اجتاز.`);
