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
 * ٢. **ازديادُ العدد** عن المسجَّل — **وقد تغيّرت شجرةُ الاعتماديات**.
 *    فحزمةٌ جديدةٌ تجرّ ثغرةً تُوقف الدفعة، وشجرةُ Medusa الثابتة لا.
 * ٣. **ثغرةٌ في اعتماديةٍ مباشرةٍ ليست من Medusa** — تلك اخترناها نحن
 *    ونستطيع تبديلَها، فلا عذر.
 *
 * ── ولماذا صار الشرطُ الثاني مشروطاً ببصمة القفل ────────────────
 *
 * لأن العددَ وحدَه لا يفرّق بين حدثين مختلفين تماماً:
 *
 *   دفعةٌ تجرّ حزمةً بثغرة              ⇐ ذنبُ الدفعة، ونملك إصلاحَه.
 *   إخطارٌ يُنشر على شجرةٍ لم تتغيّر   ⇐ لا ذنبَ لأحد، ولا نملك إصلاحَه.
 *
 * وقد وقع الثاني فعلاً: في 2026-09-02 صار `main` أحمرَ برسالةِ «دفعةٌ
 * أضافت ثغرة» **ولم تكن دفعةٌ قد أضافت شيئاً**. نُشرت إخطاراتٌ على
 * `qs` و`uuid` وهما مثبَّتتان من قبل: المتوسطةُ ٧ ⇐ ١٠، والحرجُ صفر،
 * والعالي ٦٩ كما هو، والعشرُ كلُّها غيرُ مباشرة.
 *
 * وذلك يُدخل السكربتَ في الحال التي يحذّر منها رأسُه أعلاه: ورشةٌ تفشل
 * **ولا تستطيع أن تنجح** — لأن علاجَها الوحيد رفعُ خطّ الأساس، وهو ما
 * منعناه بأنفسنا.
 *
 * فصارت **بصمةُ `package-lock.json`** هي السقّاطة، لا الرقمُ وحدَه:
 *
 *   القفلُ تغيّر  + ازداد العدد ⇐ سقوط. الدفعةُ غيّرت الشجرة.
 *   القفلُ كما هو + ازداد العدد ⇐ تنبيهٌ يُسمّي الفرق. الشجرةُ كما هي.
 *
 * والحرجُ والاعتماديةُ المباشرةُ يبقيان مُسقِطَين في الحالين — فانجرافُ
 * الإخطارات لا يفتح باباً، وإنما يمنع اتّهاماً كاذباً.
 *
 * وبصمةٌ غيرُ مسجّلةٍ تُعامَل معاملةَ **تغيّرٍ** لا معاملةَ تطابق:
 * التشدّدُ هو الافتراضُ الصحيح في حارس.
 *
 * ــ ومعنى الرقم تغيّر تبعاً لذلك: لم يعد ميزانيةَ تسامحٍ تُمنح، بل
 * **آخرَ عدٍّ مرصودٍ لهذه الشجرة**. والسقّاطةُ انتقلت من الرقم إلى
 * البصمة. `node scripts/audit-deps.mjs --update` يسجّلهما معاً،
 * ويُراجَع في الدفعة كأيّ سطرٍ آخر.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "docs", "security-baseline.json");
const APPS = ["apps/backend", "apps/storefront"];

/** ما لا نملك إصلاحه: شجرةُ Medusa. تُستثنى من الشرط ٣ لا من ١ و٢. */
const UPSTREAM = /^@medusajs\//;

/**
 * بصمةُ شجرة الاعتماديات — على `package-lock.json` لا على `package.json`.
 *
 * القفلُ هو ما يصف الشجرة فعلاً: نسخُ كلِّ حزمةٍ غيرِ مباشرة وأصلُها.
 * و`package.json` يصف النيّة لا النتيجة — فمداه `^1.2.3` يُثبِّت اليوم
 * نسخةً ويُثبّت غداً أخرى بلا سطرٍ يتغيّر فيه.
 *
 * وغيابُ القفل يُعاد `null` فيُعامَل معاملةَ تغيّرٍ (التشدّد الافتراضي).
 */
export function fingerprintOf(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

function lockFingerprint(app) {
  try {
    return fingerprintOf(readFileSync(join(ROOT, app, "package-lock.json")));
  } catch {
    return null;
  }
}

/**
 * الحكمُ على تقريرٍ واحد. مفصولٌ عن `npm` عمداً كي يُختبر ببيانات
 * مصطنَعة — فاحصٌ لا يُختبر إلا على الحال السليمة لا يُعرف أعمى هو أم لا.
 */
export function judge(app, report, base, lockMatches = false) {
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

  // ٢) السقّاطة — على البصمة لا على الرقم وحدَه.
  for (const level of ["high", "moderate"]) {
    const allowed = base?.[level] ?? 0;
    if (counts[level] > allowed) {
      if (lockMatches) {
        // الشجرةُ لم تتغيّر: هذه إخطاراتٌ نُشرت على حزمٍ مثبَّتةٍ من قبل.
        // لا دفعةَ تُلام، ولا إصلاحَ نملكه — فتنبيهٌ لا سقوط.
        notes.push(
          `${app}: ${level} صار ${counts[level]} والمسجَّل ${allowed} — ` +
            `والقفلُ لم يتغيّر، فهذه إخطاراتٌ جديدة على شجرةٍ ثابتة لا ثغرةٌ أُضيفت. ` +
            `سجّلها بـ--update بعد مراجعتها.`
        );
      } else {
        failures.push(
          `${app}: ${level} صار ${counts[level]} والمسجَّل ${allowed} — ` +
            `والقفلُ تغيّر: دفعةٌ غيّرت الشجرة وزادت الثغرات. ` +
            `وإن كانت الزيادةُ انجرافَ إخطاراتٍ سابقاً لم يُسجَّل، فسجّله بـ--update.`
        );
      }
    } else if (counts[level] < allowed) {
      notes.push(`${app}: ${level} انخفض ${allowed} ⇐ ${counts[level]} — اخفض المسجَّل`);
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

/** الشاهد الموجب: تسعُ حالاتٍ نعرف جوابَها. */
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

  // ٣) ازديادٌ والقفلُ تغيّر ⇐ سقوط. (والافتراضُ عند غياب البصمة هو هذا.)
  const grew = judge("t", { metadata: { vulnerabilities: { high: 6 } }, vulnerabilities: {} }, base);
  if (!grew.failures.length) errs.push("الشاهد ٣: ازديادٌ مع تغيّر القفل مرّ");

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

  // ٦) نفسُ الازدياد والقفلُ **لم** يتغيّر ⇐ تنبيهٌ لا سقوط.
  //    هذه هي الحالةُ التي أوقفت `main` في 2026-09-02.
  const drift = judge(
    "t", { metadata: { vulnerabilities: { high: 6 } }, vulnerabilities: {} }, base, true
  );
  if (drift.failures.length) errs.push("الشاهد ٦: انجرافُ إخطاراتٍ على شجرةٍ ثابتة أُسقط");
  if (!drift.notes.length) errs.push("الشاهد ٦: الانجرافُ مرّ صامتاً بلا تنبيه");

  // ٧) والانجرافُ لا يفتح باباً: الحرجُ يسقط ولو كان القفلُ ثابتاً.
  const driftCrit = judge("t", {
    metadata: { vulnerabilities: { critical: 1, high: 5 } },
    vulnerabilities: { boom: { severity: "critical", isDirect: false } },
  }, base, true);
  if (!driftCrit.failures.length) errs.push("الشاهد ٧: ثغرةٌ حرجة مرّت لأن القفل ثابت");

  // ٨) وكذلك اعتماديتُنا المباشرة.
  const driftMine = judge("t", {
    metadata: { vulnerabilities: { high: 5 } },
    vulnerabilities: { "left-pad": { severity: "high", isDirect: true } },
  }, base, true);
  if (!driftMine.failures.length) errs.push("الشاهد ٨: ثغرةٌ في اعتماديةٍ لنا مرّت لأن القفل ثابت");

  // ٩) والبصمةُ نفسُها تُفحص — فهي الآن الآليّةُ الحاملة، ودالّةُ تجزئةٍ
  //    تُعيد ثابتاً لكلّ مدخلٍ تجعل كلَّ ازديادٍ «انجرافاً» فيسقط الحارس
  //    كلُّه صامتاً. ولا يُكتشف ذلك إلا بفحصها.
  const a = fingerprintOf(Buffer.from('{"lockfileVersion":3,"packages":{}}'));
  const b = fingerprintOf(Buffer.from('{"lockfileVersion":3,"packages":{"x":1}}'));
  if (a === b) errs.push("الشاهد ٩: قفلان مختلفان أعطيا البصمةَ نفسَها");
  if (a !== fingerprintOf(Buffer.from('{"lockfileVersion":3,"packages":{}}'))) {
    errs.push("الشاهد ٩: القفلُ نفسُه أعطى بصمتين — لا تطابقَ أبداً");
  }

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
console.log(`  ✅ الشاهد الموجب: تسعُ حالاتٍ معروفةُ الجواب مرّت`);

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
  const lock = lockFingerprint(app);
  // بصمةٌ غائبةٌ من أيّ الطرفين ⇐ لا تطابق. التشدّدُ هو الافتراض.
  const lockMatches = lock !== null && baseline[app]?.lockfile === lock;
  const { counts, failures, notes } = judge(app, report, baseline[app], lockMatches);
  fresh[app] = { high: counts.high, moderate: counts.moderate, lockfile: lock };

  console.log(
    `\n${app}: حرجة ${counts.critical} · عالية ${counts.high} · متوسطة ${counts.moderate} · منخفضة ${counts.low}` +
      `  ·  القفل ${lock ?? "غائب"}${lockMatches ? " (كما هو)" : " (تغيّر أو لم يُسجَّل)"}`
  );
  for (const n of notes) console.log(`  ℹ️ ${n}`);
  for (const f of failures) {
    console.error(`  ✗ ${f}`);
    failed++;
  }
  if (!failures.length) console.log(`  ✅ لا ثغرةَ تخصّنا`);
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
