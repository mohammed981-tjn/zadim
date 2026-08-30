import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ACCESS_MODULE } from "../modules/access";
import type AccessModuleService from "../modules/access/service";

/**
 * حذفُ مستخدمٍ إداريّ ⇒ إسقاطُ إسناداته.
 *
 * ── لماذا مشتركٌ لا مفتاحٌ أجنبيّ ──────────────────────────────────
 *
 * `zadim_user_role.user_id` بلا مفتاحٍ أجنبيّ لأن الربطَ عبر حدود
 * الوحدات في Medusa v2 لا يكون بـFK. فالتنظيفُ علينا.
 *
 * ── ولماذا يهمّ ───────────────────────────────────────────────────
 *
 * معرّفاتُ Medusa غيرُ متسلسلة، فاحتمالُ أن يرث مستخدمٌ جديد معرّفَ
 * قديمٍ صفرٌ عملياً — **والخطرُ ليس هذا**، بل أن يعود الحسابُ نفسه:
 * مستخدمٌ يُحذف اليوم ويُعاد إنشاؤه بنفس المعرّف بعد استعادةٍ من نسخة
 * احتياطية، فيستيقظ **حاملاً صلاحياتِ الأمس** التي ظنّ الجميع أنها
 * أُلغيت. وإسنادٌ يتيمٌ في جدولٍ لا يقرؤه أحد أسوأُ من إسنادٍ ظاهر.
 *
 * ── وسجلُّ التدقيق يبقى ───────────────────────────────────────────
 *
 * لا يُمسّ. و`actor_label` نصٌّ منسوخٌ فيه، فأثرُ من حُذف يبقى مقروءاً
 * باسمه لا بـ`NULL` (`05-rbac-matrix.md`).
 */
export default async function userDeletedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const access = container.resolve<AccessModuleService>(ACCESS_MODULE);

  const assignments = await access.listUserRoles({ user_id: data.id });
  if (!assignments.length) return;

  await access.deleteUserRoles(assignments.map((a: any) => a.id));

  // يُقيَّد لأنه تغييرُ صلاحيات — والصلاحياتُ في قائمة ما يُسجَّل
  // إلزاماً (`05-rbac-matrix.md` §5).
  await access.record({
    actor_id: null,
    actor_label: "النظام — عند حذف المستخدم",
    action: "access.assignments.purged",
    entity: "user",
    entity_id: data.id,
    old_value: { roles: assignments.map((a: any) => a.role_id) },
    new_value: null,
  });

  logger.info(
    `[zadim] أُسقطت ${assignments.length} إسناداً للمستخدم المحذوف ${data.id}`
  );
}

export const config: SubscriberConfig = {
  event: "user.deleted",
};
