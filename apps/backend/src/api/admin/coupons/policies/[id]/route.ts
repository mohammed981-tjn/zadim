import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { COUPON_POLICY_MODULE } from "../../../../../modules/promotions";
import type PromotionsPolicyService from "../../../../../modules/promotions/service";
import { validate, capWarning } from "../route";

type Body = {
  per_customer_limit?: number | null;
  max_discount?: number | null;
  first_order_only?: boolean;
  priority?: number;
};

/**
 * تعديلُ سياسةِ كوبونٍ أو حذفُها.
 *
 * ⚠️ **و`promotion_id` لا يُعدَّل**: سياسةٌ تنتقل من عرضٍ إلى عرضٍ
 * تجعل استهلاكاتٍ سُجّلت تحت الأوّل تُقاس بحدود الثاني. والانتقالُ
 * الصحيح: تُحذف وتُنشأ — فيبقى الدفترُ مقروءاً.
 */
export async function PATCH(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const promotions = req.scope.resolve<PromotionsPolicyService>(COUPON_POLICY_MODULE);
  const id = String((req.params as any).id);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const [existing] = (await promotions.listCouponPolicies({ id })) as any[];
  if (!existing) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا سياسةَ بهذا المعرّف." },
    });
  }

  const invalid = validate(body);
  if (invalid) return res.status(400).json({ error: invalid });

  const patch: Record<string, unknown> = { id };
  // `null` صريحةٌ تعني «ارفعِ القيد»، والغيابُ يعني «لا تلمسه».
  // والخلطُ بينهما يجعل تعديلَ حقلٍ يمسح غيرَه صامتاً.
  if (body.per_customer_limit !== undefined) patch.per_customer_limit = body.per_customer_limit;
  if (body.max_discount !== undefined) patch.max_discount = body.max_discount;
  if (body.first_order_only !== undefined) patch.first_order_only = Boolean(body.first_order_only);
  if (body.priority !== undefined) patch.priority = body.priority;

  await promotions.updateCouponPolicies(patch as any);
  const [policy] = (await promotions.listCouponPolicies({ id })) as any[];

  // والتنبيهُ يُعاد هنا أيضاً: من يضيف سقفاً بتعديلٍ لاحقٍ يستحقّ نفسَ
  // التحذير الذي يستحقّه من وضعه عند الإنشاء.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: found } = await query.graph({
    entity: "promotion",
    fields: ["id", "application_method.type"],
    filters: { id: existing.promotion_id },
  });

  res.json({ policy, warning_ar: capWarning(body, (found as any[])[0] ?? {}) });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const promotions = req.scope.resolve<PromotionsPolicyService>(COUPON_POLICY_MODULE);
  const id = String((req.params as any).id);

  const [existing] = (await promotions.listCouponPolicies({ id })) as any[];
  if (!existing) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا سياسةَ بهذا المعرّف." },
    });
  }

  // 🔴 والحذفُ **لا يمحو الاستهلاكات**: `zadim_coupon_redemption` دفترٌ
  // مستقلٌّ يبقى. فرفعُ السياسةِ يرفع القيدَ للمستقبل ولا يعيد كتابةَ
  // الماضي — ومن استهلك يبقى مسجَّلاً.
  await promotions.deleteCouponPolicies(id);
  res.json({ deleted: true, id, promotion_id: existing.promotion_id });
}
