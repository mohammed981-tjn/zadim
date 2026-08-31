import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ZATCA_MODULE } from "../../../../modules/zatca";
import type ZatcaModuleService from "../../../../modules/zatca/service";

/**
 * الفواتيرُ الصادرة — **قراءةٌ فقط، ولا مسارَ إصدارٍ يدويّ**.
 *
 * الإصدارُ يقع مع الطلب، تحت قفلٍ يُسلسل التسلسل. ومسارٌ يدويٌّ يعني
 * أن أحداً يستطيع إقحامَ فاتورةٍ في السلسلة أو إحداثَ فجوةٍ فيها —
 * وكلاهما يُفسَّر للهيئة.
 *
 * و`?verify=true` تُعيد حسابَ السلسلة **كاملةً**: سلسلةٌ تنكسر في وسطها
 * لا يكشفها فحصُ آخرِ صفٍّ وحده.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const zatca = req.scope.resolve(ZATCA_MODULE) as ZatcaModuleService;
  const q = req.query as Record<string, string | undefined>;

  if (q.verify === "true") {
    return res.json({ chain: await zatca.verify() });
  }

  const filters: Record<string, unknown> = {};
  if (q.order_id) filters.order_id = q.order_id;
  if (q.status) filters.status = q.status;

  const limit = Math.min(Number(q.limit ?? 50) || 50, 500);
  const [invoices, count] = await zatca.listAndCountZatcaInvoices(filters, {
    take: limit,
    order: { sequence: "DESC" },
  });

  res.json({ invoices, count, limit });
}
