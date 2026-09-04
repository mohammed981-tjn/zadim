import type { MedusaRequest } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

/**
 * هويّةُ صاحب الطلب — **من رمز الجلسة وحدَه، لا من جسم الطلب**.
 *
 * ── لماذا دالّةٌ مشتركةٌ لا سطورٌ منسوخة ──────────────────────────
 *
 * لأن هذا الاشتقاقَ **حارسُ أمنٍ لا سطرُ راحة**. ونسخُه في مسارين
 * يعني أن أحدَهما سيُعدَّل يوماً ولا يُعدَّل الآخر — وأشدُّهما تساهلاً
 * هو الذي سيُوجَد ويُستغَلّ. فموضعُ الحكم واحدٌ لا اثنان.
 *
 * 🔴 **ولا يُقبل `customer_id` من الجسم أبداً.** مساراتُ المتجر عامّة،
 * ومن يرسل معرّفَ عميلٍ فيها يربط سلّتَه — أو عنوانَه — بحساب غيره.
 * والرمزُ يُمرَّر كما وصل إلى `‎/store/customers/me`، ومن يُجيبه Medusa
 * فهو صاحبُه: التحقّقُ من التوقيع يقع هناك لا هنا.
 *
 * وغيابُ الرمز **ليس خطأً**: الشراءُ ضيفاً مسارٌ كاملُ الحقوق (بند ٨).
 * فتُعيد `null` ويقرّر المُنادي.
 */
export type Identity = { customer_id: string; email: string | null } | null;

export async function identityFromToken(req: MedusaRequest): Promise<Identity> {
  const bearer = String(req.headers["authorization"] ?? "");
  if (!bearer.toLowerCase().startsWith("bearer ")) return null;

  try {
    const base = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000";
    const meRes = await fetch(`${base}/store/customers/me`, {
      headers: {
        authorization: bearer,
        "x-publishable-api-key": String(req.headers["x-publishable-api-key"] ?? ""),
      },
    });
    if (!meRes.ok) return null;
    const me = (await meRes.json()) as any;
    const id = me?.customer?.id;
    if (!id) return null;
    return {
      customer_id: String(id),
      email: me?.customer?.email ? String(me.customer.email).toLowerCase() : null,
    };
  } catch {
    // تعذّرُ التعرّف لا يمنع الشراء — يمضي ضيفاً.
    return null;
  }
}

/**
 * هل لهذا البريد حسابٌ مسجَّل؟
 *
 * 🔴 وسببُ السؤال أن `findOrCreateCustomer` في سير عمل Medusa **يربط
 * السلّةَ بالحساب متى طابق البريد بلا رمزِ جلسة**. فضيفٌ يكتب بريدَ
 * غيره يُدرج طلبَه في «طلباتي» عند صاحب الحساب بعنوانه وجوّاله،
 * **ويُفسد سجلَّ منعِ الدفع عند الاستلام** عنده (مفتاحُه الجوّالُ ثم
 * البريد — `payments/cod.ts`).
 */
export async function emailHasAccount(req: MedusaRequest, email: string): Promise<boolean> {
  if (!email) return false;
  const customerModule: any = req.scope.resolve(Modules.CUSTOMER);
  const [registered] = await customerModule.listCustomers(
    { email, has_account: true },
    { take: 1 }
  );
  return Boolean(registered);
}
