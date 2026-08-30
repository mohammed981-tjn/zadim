import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ACCESS_MODULE } from "../../../../modules/access";
import type AccessModuleService from "../../../../modules/access/service";

type Body = { user_id?: string; role_id?: string; vendor_id?: string | null };

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);
  const filter = req.query.user_id ? { user_id: String(req.query.user_id) } : {};
  const assignments = await access.listUserRoles(filter, { relations: ["role"] });
  res.json({ assignments });
}

/** إسنادُ دورٍ لمستخدم. */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);
  const body = (req.validatedBody ?? req.body ?? {}) as Body;

  if (!body.user_id || !body.role_id) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "user_id و role_id إلزاميّان" },
    });
  }

  const [role] = await access.listRoles({ id: body.role_id });
  if (!role) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا دورَ بهذا المعرّف" },
    });
  }

  // 🔴 الإسنادُ المكرَّر يُرفض صراحةً لا يُبتلع: قيدُ التفرّد في القاعدة
  // يمنعه على كل حال، والرسالةُ هنا تقول للمدير «هو مُسنَدٌ أصلاً» بدل
  // خطأِ قاعدةٍ غامض.
  const existing = await access.listUserRoles({
    user_id: body.user_id,
    role_id: body.role_id,
  });
  if (existing.length) {
    return res.status(409).json({
      error: { code: "ALREADY_ASSIGNED", message_ar: "هذا الدور مُسنَدٌ لهذا المستخدم أصلاً" },
    });
  }

  const created = await access.createUserRoles({
    user_id: body.user_id,
    role_id: body.role_id,
    vendor_id: body.vendor_id ?? null,
  });
  res.status(201).json({ assignment: created });
}
