/**
 * تطبيعُ العربية للبحث.
 *
 * ── المشكلة ───────────────────────────────────────────────────────
 *
 * «آيفون» و«أيفون» و«إيفون» و«ايفون» أربعُ سلاسلَ **مختلفةٍ بايتاً**،
 * والمستخدمون يكتبونها كلَّها. والبحثُ الذي لا يطبّعها يخذل ثلاثةَ
 * أرباعهم — **وهم يظنّون المنتجَ غيرَ موجود** لا أن بحثنا قاصر.
 *
 * ── ولماذا لا يكفي مزوّدُ البحث ───────────────────────────────────
 *
 * Orama (مزوّدُنا المحليّ) يدعم `arabic` بجذّرٍ (stemmer) — والجذرُ
 * يردّ الكلمةَ إلى أصلها، **ولا يوحّد رسمَ الهمزة**. فـ«أيفون»
 * و«ايفون» تبقيان كلمتين مختلفتين عنده. والتطبيعُ هنا يسبق الجذر ولا
 * ينوب عنه.
 *
 * ── القاعدةُ الحاكمة ──────────────────────────────────────────────
 *
 * **يُطبَّق عند الفهرسة وعند الاستعلام معاً.** واحدٌ بلا الآخر يُنتج
 * فهرساً لا يُطابَق أبداً: نُخزّن «ايفون» ونبحث عن «أيفون» فلا نجد.
 *
 * وهذه دالّةٌ **خالصة** بلا حالةٍ ولا اعتماديات — تُختبَر وحدها،
 * وتُستدعى من الفهرسة ومن الاستعلام ومن البذرة.
 */

/** الهمزاتُ بأشكالها ⇒ ألفٌ مجرَّدة. */
const ALEF = /[أإآٱؤئ]/g; // أ إ آ ٱ ؤ ئ

/** التشكيل والتطويل: يُحذفان. والتطويلُ (ـ) زخرفةٌ لا تُغيّر النطق. */
const DIACRITICS = /[ً-ٰٟـ]/g;

/** الأرقام الهندية ٠-٩ ⇒ العربية 0-9 (والفارسية ۰-۹ كذلك). */
const INDIC_DIGITS = /[٠-٩۰-۹]/g;

/**
 * يُطبّع نصاً عربياً أو مختلطاً للبحث.
 *
 * ولا يمسّ اللاتينيةَ إلا بخفض حالتها — فـ`iPhone` تصير `iphone`،
 * ويبقى المطابقُ بينها وبين «ايفون» **مسؤوليةَ المرادفات** لا
 * التطبيع: لا جذرَ لغويّاً يجمع كلمةً عربيةً بأخرى لاتينية.
 */
export function normalizeArabic(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")            // يوحّد الأشكال المتوافقة قبل أي استبدال
    .replace(DIACRITICS, "")
    .replace(ALEF, (ch) => (ch === "ؤ" ? "و" : ch === "ئ" ? "ي" : "ا"))
    .replace(/ى/g, "ي")      // ى ⇒ ي
    .replace(/ة/g, "ه")      // ة ⇒ ه
    .replace(INDIC_DIGITS, (d) => String(d.charCodeAt(0) & 0xf))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** يُطبّع كلَّ كلمةٍ على حدة — للفهرسة الرمزية. */
export function normalizeTokens(input: string): string[] {
  return normalizeArabic(input).split(" ").filter(Boolean);
}

/**
 * يوسّع الاستعلام بمرادفاته.
 *
 * والمرادفاتُ **بيانات** (ADR-006): المديرُ يضيف «ايفون ⇄ iPhone» من
 * اللوحة حين يرى ما يبحث عنه الناس ولا يجدونه — لا نشرةَ كودٍ لكل
 * علامةٍ تجارية جديدة.
 *
 * والمطابقةُ تتمّ على النصّ **المطبَّع** من الطرفين، فمدخلُ المدير
 * «آيفون» يُطابق بحثَ المستخدم «ايفون» بلا أن يعرف أحدهما بالآخر.
 */
export function expandWithSynonyms(
  query: string,
  synonyms: Array<{ term: string; synonyms: string[] }>
): string[] {
  const normalizedQuery = normalizeArabic(query);
  if (!normalizedQuery) return [];

  const out = new Set<string>([normalizedQuery]);

  // 🔴 المطابقةُ على **كلماتٍ كاملة** لا على الاحتواء.
  //
  // كانت `normalizedQuery.includes(g)`، فوقعت في مصيدةٍ كشفها فحصٌ حيّ:
  // `"iphone".includes("phone")` صحيحة، فسحب البحثُ عن «iphone» مجموعةَ
  // «جوال ⇄ phone» كلَّها وأرجع **سامسونج مع آيفون**. وبحثٌ عن علامةٍ
  // يُرجع منافسَها عطلٌ يفقد الثقة قبل أن يفقد البيع.
  const queryTokens = new Set(normalizedQuery.split(" ").filter(Boolean));

  for (const entry of synonyms) {
    const group = [entry.term, ...entry.synonyms].map(normalizeArabic).filter(Boolean);
    const matches = group.some(
      (g) =>
        g === normalizedQuery ||        // المصطلحُ كلُّه (يشمل متعدّدَ الكلمات)
        queryTokens.has(g)              // أو كلمةٌ كاملةٌ من الاستعلام
    );
    if (matches) for (const g of group) out.add(g);
  }

  return [...out];
}

/**
 * تقطيعٌ للمطابقة: يفصل على **كل ما ليس حرفاً ولا رقماً** — لا على
 * المسافة وحدها. فـ`zadim-headphones` كلمتان لا واحدة.
 */
const NON_WORD = /[^\p{L}\p{N}]+/u;

export function searchTokens(input: string): string[] {
  return normalizeArabic(input).split(NON_WORD).filter(Boolean);
}

/** أقلُّ طولٍ تُقبل عنده مطابقةُ البادئة. */
const MIN_PREFIX = 3;

/**
 * هل يطابق النصُّ أيَّ مصطلحٍ من المصطلحات؟
 *
 * ── 🔴 ولماذا ليست `includes` ────────────────────────────────────
 *
 * كانت كذلك، وكشفها منتجٌ جديدٌ اسمُه `zadim-headphones`: البحثُ عن
 * «جوال» يوسَّع إلى `phone`، و`"headphones".includes("phone")` **صحيحة**
 * — فأرجع البحثُ عن جوّالٍ سمّاعةَ رأس. ونفسُ هذا الصنف من العطل أُصلح
 * في توسيع المرادفات ثم بقي هنا في المطابقة، لأن المنطقَ كان مكرَّراً
 * في موضعين: هذا، ونسخةٌ منه في سكربت الفحص. **فالتكرارُ هو العطل**،
 * والعلاجُ دالّةٌ واحدةٌ يناديها الاثنان.
 *
 * والمطابقة: كلمةٌ كاملةٌ أو **بادئة** (`جوال` ⇒ `جوالات`)، والبادئةُ
 * من ثلاثة أحرفٍ فصاعداً — فحرفان يطابقان نصفَ الكتالوج.
 *
 * ومصطلحٌ من كلمتين يُطابق حين تُطابق **كلُّ** كلماته: «ايفون ١٥» لا
 * يجوز أن تُطابق كلَّ أيفون.
 */
export function matchesAnyTerm(haystack: string, terms: string[]): boolean {
  const tokens = searchTokens(haystack);
  if (!tokens.length) return false;

  return terms.some((term) => {
    const wanted = searchTokens(term);
    if (!wanted.length) return false;
    return wanted.every((w) =>
      tokens.some((t) => t === w || (w.length >= MIN_PREFIX && t.startsWith(w)))
    );
  });
}
