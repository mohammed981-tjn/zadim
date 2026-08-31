/**
 * أهليّةُ الإرجاع — **منطقٌ خالصٌ بلا قاعدةٍ ولا رقمٍ مبرمَج**.
 *
 * بشكل `payments/cod.ts` نفسِه وللسبب نفسِه: القرارُ يُختبر بصفوفٍ
 * مكتوبةٍ بخطّ اليد، بلا مستودعٍ ولا طلبٍ ولا خادمٍ يعمل.
 *
 * ── ولا «أربعةَ عشرَ يوماً» في أيّ سطر ──────────────────────────
 *
 * مدّةُ الإرجاع قرارُ تاجرٍ يتغيّر بالموسم وبالصنف وبنظامٍ قد يُعدَّل.
 * ورقمٌ مبرمَجٌ يعني أن تغييرَه **نشرةُ إصدار**: مبرمجٌ يعدّل، ومراجعةٌ،
 * وبناءٌ، ونشر — لتغيير رقم. فهو **بيانات** يضبطها المدير (بند ٤٨).
 */

export type ReturnPolicyInput = {
  is_enabled?: boolean | null;
  window_days?: number | null;
  accepts_opened?: boolean | null;
  excluded_category_ids?: string[] | null;
  min_order_total?: number | null;
};

export type ReturnDecision = {
  eligible: boolean;
  code?:
    | "RETURNS_DISABLED"
    | "WINDOW_EXPIRED"
    | "NOT_DELIVERED"
    | "CATEGORY_EXCLUDED"
    | "OPENED_NOT_ACCEPTED"
    | "BELOW_MINIMUM";
  reason_ar?: string;
  /** كم بقي من أيام النافذة — تعرضه الواجهةُ للعميل. */
  days_left?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ⚠️ **يُقاس بالأيام الكاملة لا بالميلي ثانية.**
 *
 * لو قُورنت الطوابعُ الزمنية مباشرةً لصار من استلم في الثانية ٥٩ من
 * اليوم الرابع عشر **مرفوضاً** ومن استلم قبله بدقيقة **مقبولاً** — فرقٌ
 * لا يفهمه أحدٌ ولا يُشرح لعميل. فيُقصّ الطرفان إلى بداية اليوم.
 */
function wholeDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((b - a) / DAY_MS);
}

export function returnEligibility(args: {
  policy?: ReturnPolicyInput | null;
  delivered_at?: Date | string | null;
  now?: Date;
  category_ids?: string[];
  is_opened?: boolean;
  order_total?: number;
}): ReturnDecision {
  const p = args.policy;

  // لا سياسةَ = لا إرجاع. **والافتراضُ منعٌ لا سماح** — كما في COD:
  // غيابُ الصفّ ليس موافقة، وقبولُ مرتجعٍ التزامٌ ماليٌّ وتشغيليّ لا
  // يُلتزَم به لأن أحداً نسي أن يملأ استمارة.
  if (!p || p.is_enabled === false) {
    return {
      eligible: false,
      code: "RETURNS_DISABLED",
      reason_ar: "الإرجاعُ غيرُ متاحٍ حالياً.",
    };
  }

  // 🔴 **ولا إرجاعَ لما لم يُسلَّم.** ما لم يصل العميلَ بعد يُلغى أو
  // تُوقَف شحنتُه — ومرتجعٌ لبضاعةٍ في الطريق يفتح استرداداً لشيءٍ
  // سيصل بعد ساعتين، فيُخصم مرّتين ويُشحن مرّتين.
  if (!args.delivered_at) {
    return {
      eligible: false,
      code: "NOT_DELIVERED",
      reason_ar: "لم يُسلَّم الطلبُ بعد — ولا إرجاعَ قبل الاستلام.",
    };
  }

  const total = Number(args.order_total ?? 0);
  if (p.min_order_total != null && args.order_total != null && total < Number(p.min_order_total)) {
    return {
      eligible: false,
      code: "BELOW_MINIMUM",
      reason_ar: "قيمةُ الطلب دون الحدّ الأدنى للإرجاع.",
    };
  }

  const excluded = new Set(p.excluded_category_ids ?? []);
  const hit = (args.category_ids ?? []).find((c) => excluded.has(c));
  if (hit) {
    return {
      eligible: false,
      code: "CATEGORY_EXCLUDED",
      reason_ar: "هذا الصنفُ من الأصناف غير القابلة للإرجاع.",
    };
  }

  if (args.is_opened && p.accepts_opened === false) {
    return {
      eligible: false,
      code: "OPENED_NOT_ACCEPTED",
      reason_ar: "لا يُقبل إرجاعُ المنتج بعد فتح عبوته.",
    };
  }

  // نافذةٌ غيرُ مضبوطة = بلا حدٍّ زمنيّ. والصمتُ هنا **سماحٌ** لا منع،
  // بخلاف غياب السياسة كلِّها: المديرُ فعّل الإرجاع صراحةً، ولو أراد
  // تقييده بمدّةٍ لكتبها.
  if (p.window_days == null) {
    return { eligible: true };
  }

  const delivered = new Date(args.delivered_at);
  const now = args.now ?? new Date();
  const elapsed = wholeDaysBetween(delivered, now);
  const window = Number(p.window_days);

  // **والحدُّ شاملٌ لا حاجز**: اليومُ الرابعَ عشرَ من نافذةِ أربعةَ عشرَ
  // يمرّ. من قرأ «١٤ يوماً» فهم أن اليوم الرابعَ عشرَ له.
  if (elapsed > window) {
    return {
      eligible: false,
      code: "WINDOW_EXPIRED",
      reason_ar: `انتهت مدّةُ الإرجاع (${window} يوماً من الاستلام).`,
      days_left: 0,
    };
  }

  return { eligible: true, days_left: window - elapsed };
}
