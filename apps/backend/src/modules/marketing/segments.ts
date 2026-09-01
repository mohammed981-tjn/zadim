/**
 * الشرائح — **قواعدُ بياناتٍ يُقيّمها منطقٌ خالص**.
 *
 * بشكل `payments/cod.ts` و`returns/policy.ts` نفسِه وللسبب نفسِه:
 * يُختبر بصفوفٍ مكتوبةٍ بخطّ اليد بلا قاعدةٍ ولا عميلٍ حقيقيّ.
 *
 * ── ولماذا قواعدُ بياناتٍ لا شرطٌ في الكود ──────────────────────
 *
 * «من اشترى أكثرَ من ألفٍ ولم يشترِ منذ ستّين يوماً» شريحةٌ يبنيها
 * المسوّقُ صباحاً لحملةٍ بعد الظهر. ولو كانت `if` في ملفٍّ لصار كلُّ
 * تجريبِ فكرةٍ نشرةَ إصدار — فتُجرَّب فكرةٌ واحدةٌ في الشهر بدل عشر
 * (بند ٤٨).
 */

export type SegmentRule = {
  /** حقلُ العميل المحسوب: `total_spent` · `order_count` · `days_since_last_order` · `city` · `has_returned` */
  field: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in";
  value: unknown;
};

export type SegmentDefinition = {
  /** `all` = كلُّ القواعد · `any` = أيُّها. والافتراضُ `all`. */
  match?: "all" | "any";
  rules: SegmentRule[];
};

/** ما يُقاس عليه — يجمعه المُنادي، ولا تقرأ هذه الدالّةُ قاعدةً. */
export type CustomerFacts = Record<string, unknown>;

function compare(actual: unknown, op: SegmentRule["op"], expected: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual as never);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual as never);
    default: {
      // ⚠️ **والمقارنةُ العدديّةُ على أعدادٍ فقط.** `"5" > 3` في
      // JavaScript صحيحةٌ بالإكراه، و`"abc" > 3` كاذبةٌ صامتة — فشريحةٌ
      // على حقلٍ نصّيٍّ كانت ستُطابِق أو لا تُطابِق بلا سببٍ مفهوم.
      // فما ليس عدداً **لا يُطابِق**، ولا يُخمَّن.
      const a = typeof actual === "number" ? actual : Number.NaN;
      const b = typeof expected === "number" ? expected : Number(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;

      if (op === "gt") return a > b;
      if (op === "gte") return a >= b;
      if (op === "lt") return a < b;
      return a <= b;
    }
  }
}

/**
 * هل ينطبق تعريفُ الشريحة على هذا العميل؟
 *
 * ⚠️ **وشريحةٌ بلا قواعدَ لا تُطابِق أحداً.** والبديلُ («تُطابِق
 * الجميع») يعني أن شريحةً أُنشئت ولم تُملأ بعد ترسل حملةً إلى كل
 * عميلٍ في المتجر. والصمتُ أرخصُ من ذلك بكثير.
 */
export function matchesSegment(def: SegmentDefinition | null, facts: CustomerFacts): boolean {
  const rules = def?.rules ?? [];
  if (!rules.length) return false;

  const results = rules.map((r) => compare(facts[r.field], r.op, r.value));
  return (def?.match ?? "all") === "any" ? results.some(Boolean) : results.every(Boolean);
}
