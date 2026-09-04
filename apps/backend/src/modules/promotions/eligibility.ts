/**
 * أهليّةُ الكوبون — **دالّةٌ خالصةٌ تُختبر بصفوفٍ مكتوبةٍ بخطّ اليد**،
 * بلا سلّةٍ ولا قاعدةٍ ولا محرّك.
 *
 * وموضعُها خارج الخدمة عمداً، كما `checkout/pricing.ts`: المنطقُ الذي
 * يقرّر «يُقبل أو يُرفض ولماذا» أثمنُ من أن يحتاج قاعدةً مُقلَعةً كي
 * يُفحص.
 *
 * ⚠️ **ولا تفحص ما يفحصه المحرّك**: انتهاءُ الصلاحية والحالةُ والحدُّ
 * الكلّيُّ ونطاقُ القواعد كلُّها عند Medusa، ومحروسةٌ بقفلِ صفٍّ عنده.
 * ومضاعفتُها هنا تُنتج جوابين لسؤالٍ واحد.
 */

export type CouponPolicy = {
  per_customer_limit: number | null;
  max_discount: number | null;
  first_order_only: boolean;
};

export type CouponContext = {
  /** كم استهلك هذا العميلُ من هذا الكوبون قبل الآن. */
  redemptions_by_customer: number;
  /** عددُ طلباتِ العميل غيرِ الملغاة — لشرط «أوّلُ طلب». */
  previous_orders: number;
  /** الخصمُ الذي سينتج فعلاً بالهللات، مقيساً على السلّة. */
  computed_discount: number;
  /** ضيفٌ بلا حساب. */
  is_guest: boolean;
};

export type CouponVerdict =
  | { ok: true }
  | { ok: false; code: string; message_ar: string };

export function checkCoupon(
  policy: CouponPolicy | null,
  ctx: CouponContext
): CouponVerdict {
  // بلا سياسةٍ عندنا: يعمل بحدود Medusa وحدَها. وغيابُ الصفّ ليس منعاً.
  if (!policy) return { ok: true };

  // 🔴 الضيفُ أوّلاً: كلُّ ما بعده يحتاج هويّةً تُعدّ عليها الاستعمالات.
  // وكوبونٌ بحدٍّ لكل عميل يُعطى لضيفٍ **بلا حدٍّ عملياً** — يُعاد
  // استعمالُه بلا نهاية.
  if (ctx.is_guest && (policy.per_customer_limit !== null || policy.first_order_only)) {
    return {
      ok: false,
      code: "SIGN_IN_REQUIRED",
      message_ar: "هذا الرمزُ لأصحاب الحسابات — سجّلِ الدخولَ لاستعماله.",
    };
  }

  if (policy.first_order_only && ctx.previous_orders > 0) {
    return {
      ok: false,
      code: "FIRST_ORDER_ONLY",
      message_ar: "هذا الرمزُ لأوّل طلبٍ فقط.",
    };
  }

  if (
    policy.per_customer_limit !== null &&
    ctx.redemptions_by_customer >= policy.per_customer_limit
  ) {
    return {
      ok: false,
      code: "PER_CUSTOMER_LIMIT",
      message_ar:
        policy.per_customer_limit === 1
          ? "استعملتَ هذا الرمزَ من قبل."
          : `استعملتَ هذا الرمزَ ${policy.per_customer_limit} مرّاتٍ — وهو حدُّه.`,
    };
  }

  // 🔴 سقفُ الخصم — وهو الذي لا يملكه المحرّك إطلاقاً.
  //
  // ولماذا **يُرفض** ولا يُقصّ الخصمُ إلى السقف: لأن القصَّ يحتاج
  // تعديلَ تسويّاتِ Medusa سطراً سطراً بعد حسابها، وهو قتالٌ مع
  // المحرّك يُنتج رقمين مختلفين في السلّة والفاتورة. والرفضُ الصريح
  // بسقفٍ مذكورٍ في الرسالة أمينٌ: التاجرُ الذي يريد سقفاً يضع كوبونَ
  // **مبلغٍ ثابت** — وهو ما يعنيه السقفُ أصلاً.
  //
  // ومسجَّلٌ في `gap-analysis.md` أن القصَّ الحقيقيَّ مؤجَّل.
  if (policy.max_discount !== null && ctx.computed_discount > policy.max_discount) {
    return {
      ok: false,
      code: "DISCOUNT_CAP",
      message_ar: `خصمُ هذا الرمز أعلى من سقفه (${(policy.max_discount / 100).toFixed(2)} ريالاً) على هذه السلّة.`,
    };
  }

  return { ok: true };
}

/**
 * ترتيبُ تطبيق الخصومات — **رقمٌ لا سلوكٌ ضمنيّ**.
 *
 * قِيس على Medusa 2.19 أن المحرّكَ يرتّب **بقيمة الخصم تنازلياً**، لا
 * «التلقائيُّ أوّلاً ثم الكوبون» كما تقول `01-domain-model.md` §٣.
 * فكوبونُ ٢٠٪ طُبِّق قبل عرضٍ تلقائيٍّ ١٠٪، والنسبُ تتراكم على الباقي.
 *
 * وهذه الدالّةُ تعطي الترتيبَ **المقرَّر عندنا**، والأصغرُ أوّلاً.
 * وما لا سياسةَ له يأخذ الافتراضَ فيقع بعد المضبوطِ صراحةً.
 */
export const DEFAULT_PRIORITY = 100;

export function orderByPriority<T extends { code: string }>(
  codes: T[],
  priorityOf: (code: string) => number | undefined
): T[] {
  return [...codes].sort((a, b) => {
    const pa = priorityOf(a.code) ?? DEFAULT_PRIORITY;
    const pb = priorityOf(b.code) ?? DEFAULT_PRIORITY;
    // وعند التساوي يبقى ترتيبُ الإدخال — فترتيبٌ عشوائيٌّ عند التعادل
    // يجعل نفسَ السلّة تُنتج مجموعين مختلفين في نداءين.
    return pa - pb;
  });
}
