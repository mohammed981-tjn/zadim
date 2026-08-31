import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { RETURNS_MODULE } from "../../../../modules/returns";
import type ReturnsModuleService from "../../../../modules/returns/service";

/**
 * سجلُّ الفحص — قراءةً وكتابة.
 *
 * ⚠️ **ولا مسارَ تعديلٍ ولا حذف**، ولو أراده المستخدم: القاعدةُ ترفضهما
 * أصلاً (ADR-028)، ومسارٌ يَعِد بما ترفضه القاعدةُ يُعيد خطأً غامضاً
 * بدل أن يقول «هذا لا يُعدَّل». والتصحيحُ سطرٌ جديد.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const returns = req.scope.resolve(RETURNS_MODULE) as ReturnsModuleService;
  const returnId = String((req.query as any).return_id ?? "");

  if (!returnId) {
    return res.status(400).json({
      error: { code: "RETURN_ID_REQUIRED", message_ar: "حدّد المرتجعَ المطلوب فحصُه." },
    });
  }

  const rows = await returns.listReturnInspections({ return_id: returnId });
  res.json({
    return_id: returnId,
    inspections: rows,
    // ما يجوز إطلاقُه إلى الرفّ الآن — تعرضه اللوحةُ رقماً، ولا تحسبه
    // بنفسها: الحسابُ في مكانٍ واحدٍ يقرؤه المُطلِقُ في القاعدة أيضاً.
    releasable: await returns.releasableQuantity(returnId),
  });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const returns = req.scope.resolve(RETURNS_MODULE) as ReturnsModuleService;
  const b = (req.body ?? {}) as Record<string, any>;

  if (!b.return_id || !b.quantity || !b.outcome || !String(b.reason_ar ?? "").trim()) {
    return res.status(400).json({
      error: {
        code: "INSPECTION_INCOMPLETE",
        message_ar: "الفحصُ يحتاج: المرتجع، والكمّية، والنتيجة، **وسبباً**.",
      },
    });
  }

  const row = await returns.inspect({
    return_id: String(b.return_id),
    return_item_id: b.return_item_id ?? null,
    inventory_item_id: b.inventory_item_id ?? null,
    quantity: Number(b.quantity),
    outcome: b.outcome,
    reason_ar: String(b.reason_ar).trim(),
    // **الفاحصُ هو المستخدمُ الموقَّع لا رقمٌ يُرسَل في الجسم.** ولولا
    // ذلك لكتب أحدُهم حكماً باسم غيره — وهذا سجلُّ مسؤوليةٍ لا وصف.
    actor_id: req.auth_context?.actor_id ?? null,
  });

  res.status(201).json({ inspection: row });
}
