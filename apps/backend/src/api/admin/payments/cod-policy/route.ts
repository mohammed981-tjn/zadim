import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PAYMENTS_MODULE } from "../../../../modules/payments";
import type PaymentsModuleService from "../../../../modules/payments/service";

type Body = {
  is_enabled?: boolean;
  max_order_total?: number | null;
  min_order_total?: number | null;
  refusals_before_block?: number | null;
  excluded_cities?: string[] | null;
  note?: string | null;
};

/**
 * سياسةُ الدفع عند الاستلام — صفٌّ واحدٌ يضبطه المالك.
 *
 * وحدودُها ليست أرقاماً هندسية: الحدُّ الأعلى موازنةٌ بين بيعٍ يُكسب
 * وشحنتين قد تُخسران عند الرفض بالباب. **ولذلك لا قيمةَ افتراضيةَ
 * لواحدٍ منها**، وغيابُ الصفّ كلِّه يعني منعَ COD لا السماحَ به.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const payments = req.scope.resolve(PAYMENTS_MODULE) as PaymentsModuleService;
  const [policy] = await payments.listCodPolicies({}, { take: 1 });
  res.json({
    policy: policy ?? null,
    // حالةٌ صريحةٌ لا `null` صامت: من يقرأ الردَّ يعرف أن COD ممنوعٌ
    // لأن أحداً لم يضبطه، لا لأن الخادم أخطأ.
    state: policy ? "configured" : "not_configured",
  });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const payments = req.scope.resolve(PAYMENTS_MODULE) as PaymentsModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const fields = {
    is_enabled: body.is_enabled ?? true,
    max_order_total: num(body.max_order_total),
    min_order_total: num(body.min_order_total),
    refusals_before_block: num(body.refusals_before_block),
    excluded_cities: body.excluded_cities ?? null,
    note: body.note ?? null,
  };

  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "number" && (!Number.isInteger(v) || v < 0)) {
      return res.status(400).json({
        error: { code: "INVALID_AMOUNT", message_ar: `${k} عددٌ صحيحٌ غيرُ سالب (بالهللات).` },
      });
    }
  }

  const [existing] = await payments.listCodPolicies({}, { take: 1 });
  const policy = existing
    ? await payments.updateCodPolicies({ id: existing.id, ...fields })
    : (await payments.createCodPolicies([fields]))[0];

  res.status(existing ? 200 : 201).json({ policy });
}
