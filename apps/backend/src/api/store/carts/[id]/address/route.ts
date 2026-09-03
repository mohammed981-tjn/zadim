import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { updateCartWorkflow } from "@medusajs/medusa/core-flows";
import {
  toMedusaAddress,
  validateNationalAddress,
} from "../../../../../modules/checkout/national-address";

/**
 * `POST /store/carts/:id/address` — **السلكُ الذي كان مقطوعاً**.
 *
 * ── ما كان يقع قبل هذا المسار ────────────────────────────────────
 *
 * شاشةُ الإتمام كانت تجمع الاسمَ والجوّالَ والعنوانَ والمدينة، وتتحقّق
 * منها، **ثم تتركها في المتصفّح**: لا دالّةَ في `lib/medusa.ts` تُحدّث
 * السلّة أصلاً. فكلُّ طلبٍ يُنشأ بلا عنوانِ شحنٍ ولا بريد — ولا أحد
 * يعرف أين يُرسَل.
 *
 * ── ولماذا مسارٌ لنا و`POST /store/carts/:id` موجودٌ عند Medusa ───
 *
 * لأن مسارَ Medusa يقبل **أيَّ** عنوان: لا يعرف رقمَ مبنىً ولا حيّاً
 * ولا رقماً إضافياً، ولا يرفض رمزاً بريدياً من ثلاثة أرقام. وهذا
 * المسارُ يفعل ثلاثةً لا يفعلها:
 *
 * ١. **يفحص** بقواعد البريد السعودي (`national-address.ts`).
 * ٢. **يخزّن مهيكلاً** في `metadata.national_address` — وهو ما تقرؤه
 *    فاتورةُ ZATCA وخطّةُ المستودعات وسياسةُ COD.
 * ٣. **يركّب** `address_1`/`address_2` لملصق الشحن من نفس المصدر.
 *
 * ⚠️ **وليس هذا حارساً.** مسارُ Medusa عامٌّ ويبقى مفتوحاً، فمن يناديه
 * مباشرةً يكتب عنواناً بلا حقولنا. والحارسُ الحقيقيّ في
 * `orchestrate.ts` قبل إنشاء الطلب — وهذا للتجربة: يقول للعميل ما
 * الخطأ **وهو يكتب**، لا بعد أن يضغط «أكّد الطلب».
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const cartId = req.params.id;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Record<string, unknown>;

  const check = validateNationalAddress(body);
  if (!check.valid) {
    return res.status(400).json({
      error: {
        code: "INVALID_ADDRESS",
        message_ar: "راجعْ حقولَ العنوان المعلَّمة.",
        // كلُّ الأخطاء لا أوّلُها: النموذجُ يُعلّم حقولَه كلَّها مرّةً
        // واحدة، ولا يجعل العميلَ يُرسل خمسَ مرّات.
        details: { fields: check.errors },
      },
    });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "completed_at"],
    filters: { id: cartId },
  });
  const cart = carts[0] as any;

  if (!cart) {
    return res.status(404).json({
      error: { code: "CART_NOT_FOUND", message_ar: "لا سلّةَ بهذا المعرّف." },
    });
  }
  // سلّةٌ أُتمّت لا يُغيَّر عنوانُها: الطلبُ خرج بالعنوان الذي كان.
  if (cart.completed_at) {
    return res.status(409).json({
      error: { code: "CART_COMPLETED", message_ar: "هذه السلّة أُتمّت من قبل." },
    });
  }

  const address = toMedusaAddress(check.value);
  const email = String(body.email ?? "").trim().toLowerCase();

  await updateCartWorkflow(req.scope).run({
    input: {
      id: cartId,
      // الشحنُ والفوترةُ واحدٌ ما لم يُفصلا: أكثرُ الطلبات كذلك،
      // وفصلُهما شاشةٌ ثانيةٌ لا تُبنى قبل أن تُطلب.
      shipping_address: address,
      billing_address: address,
      ...(email ? { email } : {}),
    } as any,
  });

  const { data: updated } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "email",
      "shipping_address.city",
      "shipping_address.phone",
      "shipping_address.address_1",
      "shipping_address.address_2",
      "shipping_address.postal_code",
    ],
    filters: { id: cartId },
  });

  res.json({ cart: updated[0] ?? null });
}
