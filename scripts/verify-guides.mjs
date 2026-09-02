#!/usr/bin/env node
/**
 * فحصُ الأدلّة الستّة (الدفعة ج).
 *
 * ── ولماذا يُفحص نصٌّ أصلاً ──────────────────────────────────────
 *
 * الأدلّةُ الوحيدُ في المستودع الذي **لا يُكشف خطؤه بالتشغيل**: كودٌ
 * خاطئٌ يسقط في بوّابة، وجملةٌ خاطئةٌ تُقرأ ويُعمَل بها. فأقصى ما
 * يستطيعه فاحصٌ آليٌّ هنا أن يمسك **الشكل**: ملفٌّ ناقص، وتاريخٌ
 * غائب، وترجمةٌ نصفُها لم تُترجَم.
 *
 * وهو لا يفحص الصدق. صدقُ الدليل مسؤوليةُ من يكتبه، وقاعدتُه في الخطة:
 * لا تصف شاشةً لم تُبنَ.
 *
 * ── ولماذا هنا لا في `verify-guard.ts` ──────────────────────────
 *
 * ذاك بوّابةُ خريطةِ الصلاحيات: يعمل بـ`medusa exec` ويحتاج قاعدةً.
 * وربطُ فحصِ وثائقَ به يجعل **عطلَ ملفٍّ نصّيٍّ يبدو عطلَ صلاحيات** —
 * ورسالةٌ تُضلّل أسوأُ من رسالةٍ ناقصة. وهذا بـNode وحدَه: بلا قاعدةٍ
 * ولا متصفّح، وثمنُه ثوانٍ.
 *
 * التشغيل: node scripts/verify-guides.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs/guides");

const AUDIENCES = [
  ["customer", "العميل"],
  ["admin", "المدير"],
  ["warehouse", "موظّف المستودع"],
];

/** سطرُ «آخر تحديث» في الرأس — بتاريخٍ كاملٍ لا بكلمة. */
const AR_DATE = /آخر تحديث:\s*(\d{4}-\d{2}-\d{2})/;
const EN_DATE = /Last updated:\s*(\d{4}-\d{2}-\d{2})/;

/** حرفٌ عربيّ. */
const ARABIC = /[؀-ۿ]/;

/** فرقٌ مقبولٌ في عدد الأقسام بين النسختين. */
const SECTION_SLACK = 1;

let failures = 0;
const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => {
  console.error(`  ⛔ ${m}`);
  failures++;
};

/**
 * أقسامُ الملفّ: عناوينُ `##` و`###`.
 *
 * ولا يُعدّ ما داخل كتلةِ شيفرة — سطرٌ يبدأ بـ`#` داخل ```` ``` ````
 * تعليقٌ لا عنوان، وعدُّه يجعل الفرقَ وهمياً.
 */
function sections(text) {
  let inFence = false;
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#{2,3}\s/.test(line)) n++;
  }
  return n;
}

/**
 * 🔴 النصُّ العربيُّ **غيرُ المعلَن** في ملفٍّ إنجليزيّ.
 *
 * وعربيّةٌ داخل ` `` ` مقصودةٌ لا منسيّة: الدليلُ الإنجليزيُّ يشرح أن
 * البحث يفهم `ايفون`، وأن السعرَ يُكتب `٣٩٩٫٠٠ ر.س` عربياً. فهي
 * **بياناتٌ مقتبَسة** لا نثرٌ لم يُترجَم.
 *
 * وهذا نفسُ مبدأ الدفعة ب: الاستثناءُ يُعلَن **في الملفّ** بعلامةٍ
 * يراها القارئ، لا في قائمةٍ بيضاءَ داخل الفاحص تُسكِت معه عطلاً
 * حقيقياً بسطرٍ لا يراه أحد.
 */
function undeclaredArabic(text) {
  const out = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (raw.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // انزع ما بين علامتَي اقتباسٍ مائلة (`…`) — فهو مقتبَسٌ معلَن.
    const bare = raw.replace(/`[^`]*`/g, "");
    if (ARABIC.test(bare)) out.push(raw.trim().slice(0, 70));
  }
  return out;
}

/* ── الشاهدُ الموجب — قبل أن يُقاس به شيء ──────────────────────── */
//
// فاحصٌ يُعيد «صفرَ مخالفات» لا يُفرَّق عن فاحصٍ أعمى. وقد وقع ذلك
// مرّتين في هذا المشروع فعلاً: فاحصُ المَسح في المرحلة ١١ أمسك واحداً
// من أربعة، وفحصُ العربية في ١١ب كان يقرأ نصَّ `<script>`. فيُجرَّب
// كلُّ فاحصٍ على طُعمٍ يجب أن يُمسَك وبريءٍ يجب ألّا يُمسَك — ويسقط
// الفحصُ كلُّه قبل أن يقرأ ملفّاً واحداً إن أخطأ.
{
  const control = [
    ["عدُّ الأقسام", sections("## أ\n\n```\n## ليس عنواناً\n```\n\n### ب\n") === 2],
    ["العربيةُ النثرية تُمسَك", undeclaredArabic("This is عربي prose.").length === 1],
    ["والمقتبَسةُ لا تُمسَك", undeclaredArabic("Search understands `ايفون` fine.").length === 0],
    ["وما في كتلة الشيفرة لا يُمسَك", undeclaredArabic("```\nعربي\n```\n").length === 0],
    ["والتاريخُ يُقرأ", AR_DATE.test("> آخر تحديث: 2026-09-01 — كذا")],
    ["وتاريخٌ ناقصٌ يُرفض", !AR_DATE.test("> آخر تحديث: قريباً")],
  ];
  const broken = control.filter(([, ok]) => !ok).map(([name]) => name);
  if (broken.length) {
    console.error("  ⛔ الفاحصُ نفسُه لا يعمل — ولا يُبنى على نتيجته شيء:");
    for (const b of broken) console.error(`     ${b}`);
    process.exit(1);
  }
  console.log(`  ✅ شاهدُ الفاحص: ${control.length} حالةً، كلُّها كما يجب`);
}

/* ── الفحص ──────────────────────────────────────────────────────── */

for (const [slug, label] of AUDIENCES) {
  console.log(`\n== ${label} (${slug}) ==`);

  const paths = { ar: join(DIR, `${slug}.ar.md`), en: join(DIR, `${slug}.en.md`) };
  const missing = Object.entries(paths).filter(([, p]) => !existsSync(p));
  if (missing.length) {
    fail(`ملفّاتٌ غائبة: ${missing.map(([l]) => `${slug}.${l}.md`).join(" · ")}`);
    continue;
  }
  pass("النسختان موجودتان");

  const text = {
    ar: readFileSync(paths.ar, "utf8"),
    en: readFileSync(paths.en, "utf8"),
  };

  // ── سطرُ التحديث ─────────────────────────────────────────────
  //
  // ⚠️ ودليلٌ متقادمٌ أسوأُ من غيابه: من يتّبعه يصطدم بواقعٍ مختلف
  // ولا يعرف أن الخطأ في الدليل. والتاريخُ يقول للقارئ **مقابلَ أيّ
  // حالةٍ كُتب** — وهو أرخصُ ما يُشترى به هذا الأمان.
  const dates = { ar: AR_DATE.exec(text.ar)?.[1], en: EN_DATE.exec(text.en)?.[1] };
  for (const [loc, date] of Object.entries(dates)) {
    date
      ? pass(`${loc}: آخر تحديث ${date}`)
      : fail(`${slug}.${loc}.md بلا سطرِ «آخر تحديث» بتاريخٍ كامل (YYYY-MM-DD)`);
  }
  if (dates.ar && dates.en && dates.ar !== dates.en) {
    fail(`تاريخا النسختين مختلفان (${dates.ar} · ${dates.en}) — إحداهما لم تُحدَّث`);
  }

  // ── تقاربُ الأقسام ───────────────────────────────────────────
  //
  // 🔴 ترجمةٌ نصفُها ناقصٌ لا تُمسَك بقراءة: النسخةُ الإنجليزيةُ
  // تبدو سليمةً تماماً، وينقصها قسمُ «الإرجاع» كلُّه. وعددُ الأقسام
  // أرخصُ ما يكشف ذلك.
  const counts = { ar: sections(text.ar), en: sections(text.en) };
  const gap = Math.abs(counts.ar - counts.en);
  gap <= SECTION_SLACK
    ? pass(`الأقسام متقاربة (ar ${counts.ar} · en ${counts.en})`)
    : fail(
        `فرقُ ${gap} أقسامٍ بين النسختين (ar ${counts.ar} · en ${counts.en}) — ` +
          `ترجمةٌ ناقصة`
      );

  // ── ولا نثرَ عربيٍّ في النسخة الإنجليزية ─────────────────────
  const strays = undeclaredArabic(text.en);
  strays.length === 0
    ? pass("ولا نثرَ عربيٍّ غيرَ معلَنٍ في النسخة الإنجليزية")
    : fail(
        `${strays.length} سطراً عربياً في ${slug}.en.md — ` +
          `أوّلُها: ${strays.slice(0, 2).map((l) => `«${l}»`).join(" · ")}`
      );

  // ── ولا نصَّ لصقاً: النسختان ليستا الملفَّ نفسَه ─────────────
  text.ar.trim() !== text.en.trim()
    ? pass("والنسختان مختلفتان فعلاً")
    : fail(`${slug}.en.md نسخةٌ حرفيةٌ من العربية`);
}

/* ── 🔴 وكلُّ شاشةٍ ذُكرت في دليل المدير موجودةٌ فعلاً ───────────── */
//
// هذا وحدَه ما يمسك **الخطرَ الحقيقيَّ في دفعة توثيق**: دليلٌ يصف
// شاشةً لا وجودَ لها. فمديرٌ يبحث عن زرٍّ غيرِ موجودٍ يظنّ النظامَ
// معطوباً — والخطأ في الدليل لا في النظام، ولا سبيلَ له إلى معرفة ذلك.
//
// ويُفحص الاتجاهان: ما ذُكر يجب أن يوجد، **وما وُجد يجب أن يُذكر**.
// فالثاني يمسك شاشةً تُبنى غداً ويُنسى إدراجُها، فيبقى الدليلُ يقول
// عنها «API فقط» بعد أن صار لها زرّ.
{
  console.log("\n== شاشاتُ اللوحة ==");
  const ROUTES = join(ROOT, "apps/backend/src/admin/routes/zadim");
  const guide = readFileSync(join(DIR, "admin.ar.md"), "utf8");

  const mentioned = new Set([...guide.matchAll(/\/app\/zadim([a-z/-]*)/g)].map((m) => m[1]));

  const ghosts = [...mentioned].filter(
    (sub) => !existsSync(join(ROUTES, sub, "page.tsx"))
  );
  ghosts.length === 0
    ? pass(`${mentioned.size} شاشةً مذكورةً، كلُّها موجودةٌ فعلاً`)
    : fail(
        `الدليلُ يصف شاشاتٍ لا وجودَ لها: ${ghosts
          .map((s) => `/app/zadim${s}`)
          .join(" · ")}`
      );

  const built = readdirSync(ROUTES, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name === "page.tsx")
    .map((e) => join(e.parentPath ?? e.path, e.name).slice(ROUTES.length).replace(/\/?page\.tsx$/, ""));

  const unmentioned = built.filter((sub) => !mentioned.has(sub));
  unmentioned.length === 0
    ? pass(`و${built.length} شاشةً مبنيّةً، كلُّها مذكورةٌ في الدليل`)
    : fail(
        `شاشاتٌ مبنيّةٌ لا يذكرها الدليل: ${unmentioned
          .map((s) => `/app/zadim${s}`)
          .join(" · ")} — والدليلُ لا يزال يقول «API فقط»`
      );
}

if (failures) {
  console.error(`\n⛔ سقط ${failures} فحصاً من فحوص الأدلّة.`);
  process.exit(1);
}
console.log("\n✅ الأدلّةُ الستّة: موجودةٌ ومؤرَّخةٌ ومتقاربةُ الأقسام.");
