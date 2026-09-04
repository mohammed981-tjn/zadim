import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ACCESS_MODULE } from "../../../../../modules/access";
import type AccessModuleService from "../../../../../modules/access/service";

type Body = {
  limits?: Array<{
    permission_slug: string;
    max_amount?: string | number | null;
    max_count?: number | null;
    requires_second_approval?: boolean;
  }>;
};

/**
 * تعديلُ حدود الدور — وهو المقصود بـ«يرفعه المدير حين يثق ويخفضه حين
 * يشكّ» (بند ٤٨).
 *
 * **والصلاحياتُ نفسها لا تُعدَّل من هنا عمداً**: الأدوارُ السبعة أدوارُ
 * نظام، ومنحُ دورٍ صلاحيةً جديدة تغييرٌ في المعمار يستحق مراجعةَ كودٍ
 * لا نداءً ليلياً من لوحة. والحدُّ رقمٌ تشغيليّ، والصلاحيةُ قرارُ بنية.
 */
export async function PATCH(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);
  const roleId = req.params.id;

  const [role] = await access.listRoles({ id: roleId });
  if (!role) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا دورَ بهذا المعرّف" },
    });
  }

  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;
  const incoming = body.limits ?? [];

  const current = await access.listRoleLimits({ role_id: roleId });
  const byPerm = new Map(current.map((l: any) => [l.permission_slug, l]));

  // الصلاحياتُ المعروفة — تُقرأ مرّةً لا مع كلّ حدّ.
  const knownPermissions = new Set(
    (await access.listPermissions({})).map((p: any) => p.slug)
  );

  for (const limit of incoming) {
    if (!limit?.permission_slug) {
      return res.status(400).json({
        error: { code: "INVALID_BODY", message_ar: "كلُّ حدٍّ يحتاج permission_slug" },
      });
    }

    // 🔴 حدٌّ لصلاحيةٍ لا وجودَ لها **يُكتب ولا يفعل شيئاً**: `can()`
    // يبحث عن الحدّ بـ`permission_slug`، فحرفٌ زائدٌ في الاسم يجعل
    // المديرَ يرى سقفاً في لوحته والنظامَ يتصرّف بلا سقف. والخطأُ
    // صامتٌ تماماً — ولا يُكتشف إلا باستردادٍ كبيرٍ مرّ.
    if (!knownPermissions.has(limit.permission_slug)) {
      return res.status(400).json({
        error: {
          code: "UNKNOWN_PERMISSION",
          message_ar: `لا صلاحيةَ باسم «${limit.permission_slug}» — وحدٌّ لصلاحيةٍ غيرِ موجودةٍ لا يحرس شيئاً.`,
        },
      });
    }

    // والعددُ يُفحص كما يُفحص المبلغ. وكان بلا فحص: `max_count = -1`
    // يُقبل، ثم يقارن `can()` كلَّ عددٍ به فيرفض **كلَّ** دفعة — قفلٌ
    // تامٌّ يبدو عطلَ نظامٍ لا خطأَ إدخال.
    if (
      limit.max_count != null &&
      (!Number.isInteger(limit.max_count) || limit.max_count < 0)
    ) {
      return res.status(400).json({
        error: {
          code: "INVALID_BODY",
          message_ar: `max_count عددٌ صحيحٌ غيرُ سالب، ووصل «${limit.max_count}»`,
        },
      });
    }
    // المبلغُ هللاتٌ صحيحة (ADR-008). وقيمةٌ بكسورٍ **تُرفض** ولا
    // تُقرَّب صامتاً — التقريبُ الصامت في حقلٍ ماليّ عطلٌ لا تسامح فيه.
    if (limit.max_amount != null && !/^\d+$/.test(String(limit.max_amount))) {
      return res.status(400).json({
        error: {
          code: "INVALID_BODY",
          message_ar: `max_amount يجب أن يكون هللاتٍ صحيحة، ووصل «${limit.max_amount}»`,
        },
      });
    }

    const payload = {
      role_id: roleId,
      permission_slug: limit.permission_slug,
      // بعد التحقّق أعلاه، النصُّ رقمٌ صحيحٌ قطعاً. والتحويلُ هنا لا
      // يفقد دقّةً: الهللاتُ تبقى تحت حدّ الأعداد الآمنة بمراحل.
      max_amount: limit.max_amount == null ? null : Number(limit.max_amount),
      max_count: limit.max_count ?? null,
      requires_second_approval: limit.requires_second_approval ?? false,
    };
    const existing = byPerm.get(limit.permission_slug) as any;
    if (existing) await access.updateRoleLimits({ id: existing.id, ...payload });
    else await access.createRoleLimits(payload);
  }

  const [updated] = await access.listRoles({ id: roleId }, { relations: ["limits"] });
  res.json({ role: updated });
}
