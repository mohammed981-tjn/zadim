/**
 * أهليّةُ الدفع عند الاستلام — **دالّةٌ خالصة**.
 *
 * لا قاعدةَ ولا حاوية: تأخذ السياسةَ والرفضاتِ والطلبَ وتُعيد الحكم.
 * فتُختبر بعشرين حالةً في جزءٍ من الثانية، **ولا رقمَ فيها**: كلُّ حدٍّ
 * يأتي من السياسة، وسياسةٌ فارغةٌ تعني «بلا حدّ» لا «الحدُّ الافتراضيّ
 * كذا».
 */

export type CodPolicyInput = {
  is_enabled?: boolean | null;
  max_order_total?: number | null;
  min_order_total?: number | null;
  refusals_before_block?: number | null;
  excluded_cities?: string[] | null;
};

export type CodDecision =
  | { eligible: true }
  | {
      eligible: false;
      code:
        | "COD_DISABLED"
        | "COD_ABOVE_LIMIT"
        | "COD_BELOW_MINIMUM"
        | "COD_CITY_EXCLUDED"
        | "COD_CUSTOMER_BLOCKED";
      reason_ar: string;
    };

/**
 * مفتاحُ العميل: الجوّالُ مطبَّعاً، وإلا البريدُ بحروفٍ صغيرة.
 *
 * **والتطبيعُ ليس ترفاً**: `+966 50 123 4567` و`0501234567` و
 * `٠٥٠١٢٣٤٥٦٧` رقمٌ واحدٌ يكتبه الناسُ بثلاث صور. وبلا توحيدها يفلت
 * من المنع بتغيير صيغة الكتابة وحدها.
 */
export function customerKey(input: { phone?: string | null; email?: string | null }): string {
  const phone = (input.phone ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) & 0xf));
  const digits = phone.replace(/\D/g, "");
  if (digits) {
    // آخرُ تسعة أرقام: تُسقط `+966` و`00966` والصفرَ المحلّي معاً.
    return digits.slice(-9);
  }
  return (input.email ?? "").trim().toLowerCase();
}

export function codEligibility(args: {
  policy?: CodPolicyInput | null;
  order_total: number;
  city?: string | null;
  refusals?: number;
}): CodDecision {
  const p = args.policy;

  // لا سياسةَ = لا COD. **والافتراضُ منعٌ لا سماح**: تفعيلُ وسيلةِ دفعٍ
  // بمخاطرةٍ تشغيلية قرارُ مالكٍ صريح، وغيابُ الصفّ ليس موافقة.
  if (!p || p.is_enabled === false) {
    return {
      eligible: false,
      code: "COD_DISABLED",
      reason_ar: "الدفعُ عند الاستلام غيرُ متاحٍ حالياً.",
    };
  }

  const total = Number(args.order_total) || 0;

  if (p.max_order_total != null && total > Number(p.max_order_total)) {
    return {
      eligible: false,
      code: "COD_ABOVE_LIMIT",
      reason_ar: "قيمةُ الطلب تتجاوز حدَّ الدفع عند الاستلام. اختر وسيلةَ دفعٍ أخرى.",
    };
  }

  if (p.min_order_total != null && total < Number(p.min_order_total)) {
    return {
      eligible: false,
      code: "COD_BELOW_MINIMUM",
      reason_ar: "قيمةُ الطلب أقلُّ من الحدّ الأدنى للدفع عند الاستلام.",
    };
  }

  const city = (args.city ?? "").trim();
  const excluded = (p.excluded_cities ?? []).map((c) => String(c).trim());
  if (city && excluded.includes(city)) {
    return {
      eligible: false,
      code: "COD_CITY_EXCLUDED",
      reason_ar: "الدفعُ عند الاستلام غيرُ متاحٍ لهذه المدينة.",
    };
  }

  if (
    p.refusals_before_block != null &&
    (args.refusals ?? 0) >= Number(p.refusals_before_block)
  ) {
    return {
      eligible: false,
      code: "COD_CUSTOMER_BLOCKED",
      reason_ar: "الدفعُ عند الاستلام غيرُ متاحٍ لهذا الحساب. اختر وسيلةَ دفعٍ أخرى.",
    };
  }

  return { eligible: true };
}
