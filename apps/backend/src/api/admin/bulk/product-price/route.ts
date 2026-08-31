import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";
import { BULK_MODULE } from "../../../../modules/bulk";
import type BulkModuleService from "../../../../modules/bulk/service";

type Body = {
  variant_ids?: string[];
  currency_code?: string;
  /** نسبةٌ مئوية موجبةٌ أو سالبة، أو مبلغٌ ثابتٌ بالهللات — أحدُهما. */
  percent?: number;
  amount?: number;
  note?: string | null;
};

/**
 * دفعةُ تسعير — **تُحضَّر ثم تُطبَّق، وتُتراجَع**.
 *
 * والقيمُ القديمة تُقرأ **قبل** الكتابة وتُحفظ. ومن يرفع الأسعارَ ١٠٪
 * ثم يكتشف أنه اختار التصنيفَ الخطأ لا يملك بعدها أن يعرف الأسعارَ
 * القديمة — إلا من هذا السجلّ.
 *
 * ⚠️ **والسقفُ ليس هنا**: عددُ الأصناف يحرسه `products.bulk_update`
 * بسقفٍ في `zadim_role_limit` **يختلف بالدور** (المرحلة ١). ورقمٌ ثانٍ
 * في هذا الملفّ يجعل للنظام حدّين يفترقان يومَ يرفع المالكُ السقف.
 */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const bulk = req.scope.resolve(BULK_MODULE) as BulkModuleService;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const ids = body.variant_ids ?? [];
  const currency = (body.currency_code ?? "sar").toLowerCase();
  const hasPercent = body.percent !== undefined && body.percent !== null;
  const hasAmount = body.amount !== undefined && body.amount !== null;

  if (!ids.length || hasPercent === hasAmount) {
    return res.status(400).json({
      error: {
        code: "INVALID_BODY",
        message_ar: "variant_ids غيرُ فارغة، وواحدٌ من percent أو amount لا كلاهما.",
      },
    });
  }

  // القراءةُ **قبل** الكتابة: بعدها تُعيد الجديدَ فيصير التراجعُ
  // كتابةَ ما هو مكتوب.
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "calculated_price.*"],
    filters: { id: ids },
    context: { calculated_price: QueryContext({ currency_code: currency }) },
  });

  const changes = (variants as any[])
    .map((v) => {
      const current = v?.calculated_price?.calculated_amount;
      if (current === null || current === undefined) return null;
      const old = Math.round(Number(current));
      const next = hasPercent
        ? Math.round(old * (1 + Number(body.percent) / 100))
        : Math.round(Number(body.amount));
      if (next < 0) return null;
      return {
        entity_id: v.id,
        field: `price:${currency}`,
        old_value: String(old),
        new_value: String(next),
      };
    })
    .filter(Boolean) as Array<{ entity_id: string; field: string; old_value: string; new_value: string }>;

  if (!changes.length) {
    return res.status(400).json({
      error: {
        code: "NO_PRICED_VARIANTS",
        message_ar: "لا متغيّرَ له سعرٌ بهذه العملة — لا شيءَ يُغيَّر.",
      },
    });
  }

  const op = await bulk.prepare({
    kind: hasPercent ? "product_price_percent" : "product_price_absolute",
    entity_type: "product_variant",
    requested_by: (req as any).auth_context?.actor_id ?? null,
    note: body.note ?? null,
    changes,
  });

  const write = async (c: { entity_id: string; new_value: string | null }) => {
    await updateProductVariantsWorkflow(req.scope).run({
      input: {
        product_variants: [
          {
            id: c.entity_id,
            prices: [{ currency_code: currency, amount: Number(c.new_value) }],
          },
        ],
      },
    });
  };

  const { applied } = await bulk.apply(op.id, write as any);

  res.status(201).json({
    operation_id: op.id,
    prepared: changes.length,
    applied,
    reverted_hint: `POST /admin/bulk/${op.id}/revert`,
  });
}
