import { createHash } from "crypto";

/**
 * سلسلةُ الفواتير — **الجزءُ الذي لا يُضاف بأثرٍ رجعيّ**.
 *
 * ── لماذا اليوم لا لاحقاً ────────────────────────────────────────
 *
 * المرحلةُ الثانية من الفوترة تشترط سلسلةً مرتبطة: كلُّ فاتورةٍ تحمل
 * تجزئةَ التي قبلها، وتسلسلاً **غيرَ منقطع** لا فجوةَ فيه ولا تكرار.
 *
 * فلو أُطلق المتجرُ بلا ذلك ثم أُضيف بعد عشرة آلاف طلب، **فالعشرةُ آلاف
 * السابقة ليست في السلسلة** ولا تدخلها بأثرٍ رجعيّ — لأن كلَّ واحدةٍ كان
 * يجب أن تُختم لحظةَ إصدارها. والخياران عندها: فجوةٌ تُفسَّر للهيئة، أو
 * إعادةُ بناء طبقة المال كلِّها.
 *
 * ── 🔴 وما نبنيه اليوم وما لا نبنيه — بصراحة ────────────────────
 *
 * التجزئةُ التي تطلبها الهيئة تُحسب على **XML المعياريّ (UBL 2.1)
 * الموقَّع بشهادة**. ولا شهادةَ عندنا ولا مزوّدَ معتمد، وبناءُ التوقيع
 * بأنفسنا مرفوضٌ صراحةً (`06-saudi-layer.md`: «مجالٌ يُخطئ فيه
 * المتخصّصون»).
 *
 * **فالسلسلةُ هنا سلسلتُنا نحن**: تجزئةٌ على حمولةٍ معياريّةٍ من عندنا.
 * وهي **لا تساوي** تجزئةَ الهيئة ولا تدّعي ذلك.
 *
 * والذي يجعل الانتقالَ ممكناً لاحقاً ليس تطابقَ الدالّة، بل:
 *
 * > **اكتمالُ الحمولة المخزَّنة وحرمتُها.** كلُّ حقلٍ يحتاجه الـXML
 * > محفوظٌ لحظةَ الإصدار ولا يُعدَّل بعدها. فيوم يُربط مزوّدٌ معتمد
 * > يُولَّد الـXML من الحمولة نفسِها، بالترتيب، وتُحسب سلسلةُ الهيئة
 * > كاملةً — لأن المادّةَ موجودةٌ لم تضع.
 *
 * وهذا هو الفرقُ بين «صمّمناها اليوم» و«سنضيفها لاحقاً».
 *
 * ⚠️ **ويُراجَع قبل الإطلاق**: قيمةُ التجزئة الأولى وصيغةُ الحمولة
 * تُثبَّتان من مواصفة الهيئة الحالية ومن المزوّد المعتمد. وما هنا
 * بنيةٌ صحيحةٌ لا شهادةُ مطابقة.
 */

/**
 * تجزئةُ الفاتورة الأولى.
 *
 * وتُحسب ولا تُكتب رقماً: المواصفة تصفها بأنها تجزئةُ السلسلة `"0"`
 * مكتوبةً ستّ عشريّاً ثم بـBase64. وثابتٌ منسوخٌ من ذاكرةِ أحدٍ يُخطئ
 * بايتاً فتُرفض السلسلةُ كلُّها ولا يُعرف السبب.
 */
export function genesisHash(): string {
  return Buffer.from(createHash("sha256").update("0").digest("hex"), "utf8").toString("base64");
}

/**
 * حمولةٌ معياريّة: مفاتيحُ مرتَّبةٌ أبجدياً، وبلا مسافاتٍ زائدة.
 *
 * والترتيبُ ليس تجميلاً: `JSON.stringify` يتبع ترتيبَ الإدخال، فكائنان
 * بنفس المحتوى وترتيبٍ مختلفٍ يعطيان تجزئتين — **فتنكسر السلسلةُ عند
 * أوّل إعادةِ حسابٍ** لسببٍ لا يظهر في البيانات.
 */
export function canonicalize(payload: unknown): string {
  const walk = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    return Object.keys(v)
      .sort()
      .reduce((acc: any, k) => {
        acc[k] = walk(v[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(walk(payload));
}

/** تجزئةُ فاتورةٍ = تجزئةُ (تجزئةِ ما قبلها + حمولتِها المعياريّة). */
export function invoiceHash(previousHash: string, payload: unknown): string {
  return createHash("sha256")
    .update(previousHash)
    .update(canonicalize(payload))
    .digest("base64");
}

export type ChainRow = {
  sequence: number;
  previous_hash: string;
  invoice_hash: string;
  payload: unknown;
};

/**
 * فحصُ سلسلةٍ كاملة: التسلسلُ متّصلٌ، وكلُّ تجزئةٍ تطابق حسابَها.
 *
 * ويُشغَّل على القاعدة كلِّها في البوّابة — **لا على عيّنة**: سلسلةٌ
 * تنكسر في وسطها لا يكشفها فحصُ آخرِ صفٍّ وحده.
 */
export function verifyChain(rows: ChainRow[]): {
  ok: boolean;
  broken_at?: number;
  reason?: string;
} {
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence);

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const expectedSeq = i === 0 ? sorted[0].sequence : sorted[i - 1].sequence + 1;
    if (row.sequence !== expectedSeq) {
      return { ok: false, broken_at: row.sequence, reason: "فجوةٌ في التسلسل" };
    }

    const expectedPrev = i === 0 ? genesisHash() : sorted[i - 1].invoice_hash;
    if (i > 0 && row.previous_hash !== expectedPrev) {
      return { ok: false, broken_at: row.sequence, reason: "تجزئةُ السابقة لا تطابق" };
    }

    if (invoiceHash(row.previous_hash, row.payload) !== row.invoice_hash) {
      return { ok: false, broken_at: row.sequence, reason: "التجزئةُ لا تطابق الحمولة" };
    }
  }

  return { ok: true };
}
