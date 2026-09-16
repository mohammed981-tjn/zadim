/**
 * اختباراتُ تطبيع العربية — `modules/catalog/arabic.ts`.
 *
 * ── المشكلةُ التي تحلّها ─────────────────────────────────────────
 *
 * «آيفون» و«أيفون» و«إيفون» و«ايفون» أربعُ سلاسلَ **مختلفةٍ بايتاً**،
 * والناسُ يكتبونها كلَّها. والبحثُ الذي لا يطبّعها يخذل ثلاثةَ أرباعهم
 * — **وهم يظنّون المنتجَ غيرَ موجود** لا أن بحثنا قاصر.
 *
 * ── والعطبُ المسجَّلُ فيها وقع مرّتين ────────────────────────────
 *
 * `"headphones".includes("phone")` صحيحة. فبحثٌ عن «جوال» يوسَّع إلى
 * `phone` فيُرجع **سمّاعةَ رأس**، وبحثٌ عن `iphone` يسحب مجموعةَ
 * «جوال ⇄ phone» فيُرجع **سامسونج مع آيفون**. وبحثٌ عن علامةٍ يُرجع
 * منافسَها عطلٌ يفقد الثقةَ قبل أن يفقد البيع.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeArabic,
  normalizeTokens,
  expandWithSynonyms,
  searchTokens,
  matchesAnyTerm,
} from "../src/modules/catalog/arabic.ts";

// ──────────────── التطبيع ────────────────

test("🔴 الهمزاتُ الأربعُ تلتقي في رسمٍ واحد", () => {
  const forms = ["آيفون", "أيفون", "إيفون", "ايفون", "ٱيفون"];
  const all = new Set(forms.map(normalizeArabic));
  assert.equal(all.size, 1, `تفرّقت: ${[...all].join(" · ")}`);
});

test("ؤ ⇒ و  ·  ئ ⇒ ي  — لا تُسحقان ألفاً", () => {
  // «مؤن» ليست «مان»، و«سئل» ليست «سال». وسحقُ الهمزة ألفاً في كلّ
  // موضعٍ يخلط كلماتٍ لا تُخلط.
  assert.equal(normalizeArabic("مؤن"), "مون");
  assert.equal(normalizeArabic("سئل"), "سيل");
});

test("ى ⇒ ي  ·  ة ⇒ ه  — والناسُ يكتبونهما بالوجهين", () => {
  assert.equal(normalizeArabic("مصطفى"), normalizeArabic("مصطفي"));
  assert.equal(normalizeArabic("سمّاعة"), normalizeArabic("سماعه"));
});

test("التشكيلُ والتطويلُ يُحذفان", () => {
  assert.equal(normalizeArabic("مُحَمَّدٌ"), "محمد");
  assert.equal(normalizeArabic("ســـمّاعة"), normalizeArabic("سماعه"));
});

test("الأرقامُ الهندية والفارسية ⇒ عربية", () => {
  assert.equal(normalizeArabic("ايفون ١٥"), "ايفون 15");
  assert.equal(normalizeArabic("ايفون ۱۵"), "ايفون 15");
});

test("اللاتينيةُ تُخفَض حالتُها ولا تُمسّ بغير ذلك", () => {
  assert.equal(normalizeArabic("iPhone 15 Pro"), "iphone 15 pro");
});

test("المسافاتُ تُوحَّد وتُقصّ — وفارغٌ يبقى فارغاً", () => {
  assert.equal(normalizeArabic("  ايفون   15  "), "ايفون 15");
  assert.equal(normalizeArabic(""), "");
});

test("normalizeTokens: كلماتٌ مطبَّعةٌ بلا فراغات", () => {
  assert.deepEqual(normalizeTokens("  آيفون   ١٥ Pro "), ["ايفون", "15", "pro"]);
  assert.deepEqual(normalizeTokens("   "), []);
});

// ──────────────── التقطيع ────────────────

test("🔴 searchTokens: يفصل على كل ما ليس حرفاً ولا رقماً", () => {
  // `zadim-headphones` كلمتان لا واحدة — والفصلُ على المسافة وحدَها
  // يجعلها رمزاً واحداً لا يُطابَق.
  assert.deepEqual(searchTokens("zadim-headphones"), ["zadim", "headphones"]);
  assert.deepEqual(searchTokens("سمّاعة/رأس، ١٥"), ["سماعه", "راس", "15"]);
});

// ──────────────── المرادفات ────────────────

const SYN = [
  { term: "جوال", synonyms: ["phone", "موبايل"] },
  { term: "ايفون 15", synonyms: ["iphone 15"] },
];

test("الاستعلامُ يُوسَّع بمجموعته — والمطابقةُ على المطبَّع من الطرفين", () => {
  const out = expandWithSynonyms("آيفون 15", SYN);
  assert.ok(out.includes("ايفون 15"));
  assert.ok(out.includes("iphone 15"), "مدخلُ المدير يُطابق بلا أن يعرف أحدُهما بالآخر");
  assert.ok(!out.includes("phone"), "ولا تُسحب مجموعةٌ أخرى");
});

test("🔴 المطابقةُ على كلماتٍ كاملةٍ لا على الاحتواء", () => {
  // `"iphone".includes("phone")` صحيحة — فكان البحثُ عن «iphone» يسحب
  // مجموعةَ «جوال ⇄ phone» ويُرجع **سامسونج مع آيفون**.
  const out = expandWithSynonyms("iphone", SYN);
  assert.ok(!out.includes("جوال"), `سُحبت مجموعةٌ خاطئة: ${out.join(" · ")}`);
  assert.ok(!out.includes("موبايل"));
});

test("كلمةٌ كاملةٌ داخل استعلامٍ أطولَ تسحب مجموعتَها", () => {
  const out = expandWithSynonyms("افضل جوال 2026", SYN);
  assert.ok(out.includes("phone"));
  assert.ok(out.includes("موبايل"));
});

test("مصطلحٌ من كلمتين يُطابق حين يُطابق كلُّه", () => {
  assert.ok(expandWithSynonyms("ايفون 15", SYN).includes("iphone 15"));
  assert.ok(!expandWithSynonyms("ايفون", SYN).includes("iphone 15"), "«ايفون» وحدَها ليست «ايفون 15»");
});

test("استعلامٌ فارغٌ ⇒ لا توسيع", () => {
  assert.deepEqual(expandWithSynonyms("   ", SYN), []);
});

// ──────────────── المطابقة ────────────────

test("🔴 سمّاعةُ الرأس لا تُطابق «جوال» — العطبُ الذي كشفه منتجٌ حقيقيّ", () => {
  // `"headphones".includes("phone")` صحيحة، فأرجع البحثُ عن جوّالٍ
  // سمّاعةَ رأس.
  assert.equal(matchesAnyTerm("zadim-headphones", ["phone"]), false);
  assert.equal(matchesAnyTerm("سمّاعة رأس", ["جوال"]), false);
});

test("البادئةُ تُطابق من ثلاثة أحرفٍ فصاعداً", () => {
  // «جوال» ⇒ «جوالات». وحرفان يطابقان نصفَ الكتالوج.
  assert.equal(matchesAnyTerm("جوالات ذكية", ["جوال"]), true);
  assert.equal(matchesAnyTerm("جوالات ذكية", ["جو"]), false, "حرفان لا يكفيان");
  assert.equal(matchesAnyTerm("سماعات", ["سماعه"]), false, "والبادئةُ من الأمام لا من الخلف");
});

test("الكلمةُ الكاملةُ تُطابق ولو اختلف رسمُها", () => {
  assert.equal(matchesAnyTerm("آيفون ١٥ برو", ["ايفون"]), true);
  assert.equal(matchesAnyTerm("iPhone 15", ["iphone"]), true);
});

test("🔴 مصطلحٌ من كلمتين يحتاج مطابقةَ كلماته كلِّها", () => {
  // «ايفون ١٥» لا يجوز أن تُطابق كلَّ أيفون.
  assert.equal(matchesAnyTerm("ايفون 15 برو", ["ايفون 15"]), true);
  assert.equal(matchesAnyTerm("ايفون 14", ["ايفون 15"]), false);
});

test("نصٌّ فارغٌ أو مصطلحٌ فارغٌ لا يُطابق شيئاً", () => {
  assert.equal(matchesAnyTerm("", ["جوال"]), false);
  assert.equal(matchesAnyTerm("جوال", [""]), false);
  assert.equal(matchesAnyTerm("جوال", []), false);
});
