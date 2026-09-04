import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { applyCoupon, removeCoupon } from "../../../../../modules/promotions/apply";
import { identityFromToken } from "../../../../../modules/checkout/identity";

type Body = { code?: string };

/**
 * كوبونُ السلّة — `POST` يضع و`DELETE` ينزع.
 *
 * 🔴 **ولا يُقبل `customer_id` من الجسم**: يُشتقّ من رمز الجلسة. ومعرّفٌ
 * في الجسم يجعل من يعرف معرّفَ غيره **يستهلك كوبوناً باسمه** — أو
 * يتجاوز حدَّه بانتحال هويّةٍ لم تستعمله.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;
  const identity = await identityFromToken(req);

  const out = await applyCoupon(req.scope, {
    cart_id: req.params.id,
    code: String(body.code ?? ""),
    customer_id: identity?.customer_id ?? null,
  });

  if (!out.ok) {
    const status =
      out.code === "CODE_REQUIRED" ? 400 : out.code === "CODE_INVALID" ? 404 : 409;
    return res.status(status).json({ error: { code: out.code, message_ar: out.message_ar } });
  }
  return res.json({ applied: true, code: out.code, discount_total: out.discount_total });
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  await removeCoupon(req.scope, req.params.id);
  res.json({ removed: true });
}
