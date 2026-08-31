import { AbstractPaymentProvider, PaymentSessionStatus, PaymentActions } from "@medusajs/framework/utils";

/**
 * مزوّدُ **الدفع عند الاستلام** — مزوّدٌ كامل الحقوق لا استثناء.
 *
 * ── لماذا يُبنى أوّلاً، قبل مدى والبطاقات ───────────────────────
 *
 * ثلاثةُ أسباب:
 *
 * ١. **هو ما يستعمله السوق فعلاً**، وخصوصاً في أوّل طلبٍ من متجرٍ لا
 *    يعرفه العميل (`06-saudi-layer.md` §٢).
 * ٢. **لا يحتاج مفتاحاً من أحد.** مدى وApple Pay وتابي وتمارا كلُّها
 *    تحتاج حساب تاجرٍ حقيقياً ومفاتيحَ إنتاج — ولا تُبنى بمفتاحٍ وهميّ،
 *    فذاك «بياناتٌ وهمية في مسارٍ حقيقيّ» (بند ٤٨).
 * ٣. **وهو الأصعبُ على آلة الحالات** لا الأسهل: لا تفويضَ ولا تحصيلَ
 *    عند الطلب، والمالُ يُقيَّد **عند التسليم**. فمن يبني الكرتَ أوّلاً
 *    يكتشف عند COD أن افتراضاته كلَّها عن «التحصيل بعد التفويض» لا
 *    تنطبق.
 *
 * ── وما يعنيه كلُّ نداءٍ هنا ────────────────────────────────────
 *
 * | النداء | عند COD |
 * |---|---|
 * | `initiatePayment` | تسجيلُ نيّة: لا مالَ ولا حجز |
 * | `authorizePayment` | **وعدٌ لا حجز** — يُعاد `authorized` ليكتمل الطلب، ولا شيءَ في أيّ حساب |
 * | `capturePayment` | تسليمُ المندوب: هنا **يُقيَّد المال** — وحارسُ القاعدة يمنع التحصيل قبل الشحن |
 * | `refundPayment` | قبل التسليم: لا شيءَ يُردّ. بعده: نقدٌ يُصرف ويُقيَّد |
 * | `cancelPayment` | العميلُ رفض عند الباب أو أُلغي الطلب |
 *
 * ⚠️ **و`authorized` هنا ليست كذبة**: العميلُ التزم، والبضاعةُ تُحجز،
 * والمخاطرةُ محسوبةٌ بسياسةٍ (`cod.ts`). لكنّ من يقرأ `authorized` في
 * تقريرٍ ماليّ يجب أن يعرف أنها **وعدٌ لا مالٌ محجوز** — ولذلك تُميَّز
 * البيانات بـ`method: "cod"`.
 */
class CodPaymentProvider extends AbstractPaymentProvider<Record<string, unknown>> {
  static identifier = "cod";

  // مُنشئٌ صريحٌ رغم أنه لا يفعل شيئاً: الصنفُ المجرَّد يعلن مُنشئاً
  // محميّاً، وبلا هذا لا يُرى النوعُ **قابلاً للبناء** فيُردّ التسجيلُ
  // بـ«is not assignable to type Constructor<any>» — رسالةٌ لا تدلّ
  // على سببها.
  constructor(container: any, options: Record<string, unknown>) {
    super(container, options);
  }

  async initiatePayment(input: any): Promise<any> {
    return {
      id: `cod_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      data: {
        method: "cod",
        // ما زال المالُ عند العميل. وهذا الحقلُ يقرؤه كلُّ تقريرٍ ماليّ
        // كي لا يُحسب الموعودُ محصَّلاً.
        money_held: false,
        amount: input?.amount ?? null,
        currency_code: input?.currency_code ?? null,
      },
    };
  }

  async authorizePayment(input: any): Promise<any> {
    return {
      data: { ...(input?.data ?? {}), method: "cod", authorized_at: new Date().toISOString() },
      status: PaymentSessionStatus.AUTHORIZED,
    };
  }

  async capturePayment(input: any): Promise<any> {
    // التحصيلُ الفعليّ نقدٌ يستلمه المندوب. وما يُكتب هنا **قيدٌ لا
    // حركةُ مال** — والحارسُ في القاعدة يمنع أن يقع قبل الشحن.
    return {
      data: { ...(input?.data ?? {}), method: "cod", captured_at: new Date().toISOString() },
    };
  }

  async refundPayment(input: any): Promise<any> {
    return {
      data: {
        ...(input?.data ?? {}),
        method: "cod",
        refunded_at: new Date().toISOString(),
        refund_channel: "cash_or_transfer",
      },
    };
  }

  async cancelPayment(input: any): Promise<any> {
    return { data: { ...(input?.data ?? {}), method: "cod", canceled_at: new Date().toISOString() } };
  }

  async deletePayment(input: any): Promise<any> {
    return { data: input?.data ?? {} };
  }

  async getPaymentStatus(input: any): Promise<any> {
    const data = input?.data ?? {};
    if (data.canceled_at) return { status: PaymentSessionStatus.CANCELED };
    if (data.captured_at) return { status: PaymentSessionStatus.CAPTURED };
    return { status: PaymentSessionStatus.AUTHORIZED };
  }

  async retrievePayment(input: any): Promise<any> {
    return input?.data ?? {};
  }

  async updatePayment(input: any): Promise<any> {
    return { data: input?.data ?? {} };
  }

  // لا مزوّدَ خارجيّاً يُرسل شيئاً: COD يقع في الشارع لا على الشبكة.
  async getWebhookActionAndData(): Promise<any> {
    return { action: PaymentActions.NOT_SUPPORTED };
  }
}

export default CodPaymentProvider;
