import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PROCUREMENT_MODULE } from "../../../../modules/procurement";
import type ProcurementModuleService from "../../../../modules/procurement/service";

type Body = {
  name?: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  tax_number?: string | null;
  note?: string | null;
};

/**
 * الموردون (بند ٣٢).
 *
 * والاسمُ المطبَّع **لا يُقبل من الجسم**: يشتقّه المُنشئُ في الخدمة.
 * حقلٌ يحرسه فهرسٌ فريدٌ ويملؤه المُنادي بابٌ لمورّدَين بنفس الاسم.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const procurement = req.scope.resolve<ProcurementModuleService>(PROCUREMENT_MODULE);
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  // الموقوفون يبقون مقروئين بطلبٍ صريح: أوامرُهم الماضيةُ تحتاج جهةً.
  if (q.active !== "all") filters.active = q.active === "false" ? false : true;

  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
  const [suppliers, count] = await procurement.listAndCountSuppliers(filters, {
    take: limit,
    skip: Number(q.offset ?? 0) || 0,
    order: { name: "ASC" },
  });
  res.json({ suppliers, count });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const procurement = req.scope.resolve<ProcurementModuleService>(PROCUREMENT_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const name = String(body.name ?? "").trim();
  if (!name) {
    return res.status(400).json({
      error: { code: "NAME_REQUIRED", message_ar: "اسمُ المورّد مطلوب." },
    });
  }

  try {
    const supplier = await procurement.createSupplier({
      name,
      contact_name: body.contact_name ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      tax_number: body.tax_number ?? null,
      note: body.note ?? null,
    });
    return res.status(201).json({ supplier });
  } catch (err) {
    const text = String((err as Error)?.message ?? "");
    // اصطدامُ الفهرس الفريد على الاسم المطبَّع — ويُقال صراحةً: مورّدٌ
    // «موجودٌ باسمٍ آخر إملائياً» يُنشأ مرّتين ثم تتوزّع مشترياتُه عليهما.
    if (/duplicate|unique/i.test(text)) {
      return res.status(409).json({
        error: { code: "SUPPLIER_EXISTS", message_ar: "مورّدٌ بهذا الاسم موجودٌ أصلاً." },
      });
    }
    throw err;
  }
}
