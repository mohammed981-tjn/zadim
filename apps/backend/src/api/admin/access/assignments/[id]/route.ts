import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ACCESS_MODULE } from "../../../../../modules/access";
import type AccessModuleService from "../../../../../modules/access/service";

/**
 * نزعُ دورٍ عن مستخدم.
 *
 * ── لماذا لم يكن موجوداً، ولماذا وجودُه ليس ترفاً ─────────────────
 *
 * بُني الإسنادُ (`POST`) ولم يُبنَ نزعُه. وخريطةُ الصلاحيات كانت تسمح
 * بـ`DELETE` على هذا المسار منذ كُتبت — أي أن الفجوةَ كانت في المسار
 * لا في السياسة.
 *
 * وأثرُها ليس نقصَ ميزة: **موظّفٌ يترك العمل لا يُنزع دورُه إلا
 * بـ`psql`**. فيبقى محاسبٌ سابقٌ يحمل `finance.read` لأن نزعَه كان
 * يحتاج فتحَ القاعدة بيدٍ — وهو ما لا يُفعل في يومِ استقالة.
 *
 * ⚠️ **ولا يُنزع الإسنادُ الأخيرُ لدور `super_admin`**: نظامٌ بلا مديرٍ
 * عامٍّ واحدٍ على الأقلّ **لا يُصلَح من داخله** — لا مسارَ يمنح دوراً
 * إلا بصلاحيةٍ لم تعد عند أحد. فيصير الإصلاحُ بـ`psql` وحدَه، وهو ما
 * تبنيه هذه الشاشةُ لتجنّبه أصلاً.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);
  const id = String(req.params.id);

  const [assignment] = await access.listUserRoles({ id }, { relations: ["role"] });
  if (!assignment) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message_ar: "لا إسنادَ بهذا المعرّف." },
    });
  }

  const role = (assignment as any).role;
  if (role?.slug === "super_admin") {
    const holders = await access.listUserRoles({ role_id: role.id });
    if (holders.length <= 1) {
      return res.status(409).json({
        error: {
          code: "LAST_SUPER_ADMIN",
          message_ar:
            "هذا آخرُ مديرٍ عامّ — ونزعُه يترك النظامَ بلا من يمنح الأدوار، " +
            "فلا يُصلَح إلا من قاعدة البيانات. أسنِدِ الدورَ لمستخدمٍ آخرَ أوّلاً.",
        },
      });
    }
  }

  await access.deleteUserRoles(id);
  res.json({ deleted: true, id });
}
