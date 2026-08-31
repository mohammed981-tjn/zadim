import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  ruleFor,
  isExempt,
  readField,
  ADMIN_ROUTE_RULES,
  ADMIN_CONSOLE_READS,
} from "../modules/access/permission-map";
import { ACCESS_MODULE } from "../modules/access";
import type AccessModuleService from "../modules/access/service";

/**
 * بوّابةُ الحارس — تُثبت أن الخريطة تُنتج القرار الصحيح لكل مسار،
 * وأن **الرفض هو الافتراض** لما لا قاعدةَ له.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-guard.ts
 */

type MapCase = {
  name: string;
  path: string;
  method: string;
  expectPermission: string | null;   // null = لا قاعدة ⇒ يُرفض
  exempt?: boolean;
};

const MAP_CASES: MapCase[] = [
  // الأدقُّ يفوز: `/products/batch` لا تُلتقط بقاعدة `/products`
  { name: "دفعةُ المنتجات تسبق المنتجات", path: "/products/batch", method: "POST", expectPermission: "products.bulk_update" },
  { name: "قراءةُ المنتجات", path: "/products", method: "GET", expectPermission: "products.read" },
  { name: "إنشاءُ منتج", path: "/products", method: "POST", expectPermission: "products.write" },
  { name: "حذفُ منتج", path: "/products/prod_1", method: "DELETE", expectPermission: "products.delete" },
  { name: "تغييرُ سعرٍ عبر قوائم الأسعار", path: "/price-lists/pl_1", method: "PATCH", expectPermission: "products.price.update" },
  { name: "استردادُ دفعة", path: "/payments/pay_1/refund", method: "POST", expectPermission: "payments.refund" },
  { name: "تحصيلُ دفعة", path: "/payments/pay_1/capture", method: "POST", expectPermission: "payments.capture" },
  { name: "إلغاءُ طلب", path: "/orders/ord_1/cancel", method: "POST", expectPermission: "orders.cancel" },
  { name: "قراءةُ سجلّ التدقيق", path: "/access/audit", method: "GET", expectPermission: "audit.read" },
  { name: "إسنادُ دور", path: "/access/assignments", method: "POST", expectPermission: "users.manage" },
  { name: "تعديلُ المتجر", path: "/store", method: "POST", expectPermission: "settings.manage" },

  // 🔴 الأهمّ: مسارٌ لا قاعدةَ له ⇒ يُرفض
  { name: "مسارٌ مجهولٌ يُرفض افتراضاً", path: "/some-new-feature", method: "POST", expectPermission: null },
  { name: "حذفٌ على مسارٍ مجهول يُرفض", path: "/widgets/w_1", method: "DELETE", expectPermission: null },

  // المُعفاة
  { name: "الدخول معفى", path: "/auth/session", method: "POST", expectPermission: null, exempt: true },
  { name: "«من أنا» معفى", path: "/users/me", method: "GET", expectPermission: null, exempt: true },
];

export default async function verifyGuard({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const access = container.resolve<AccessModuleService>(ACCESS_MODULE);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => { logger.error(`  ⛔ ${m}`); failures++; };

  logger.info("== خريطةُ المسار ← الصلاحية ==");
  for (const c of MAP_CASES) {
    if (c.exempt) {
      isExempt(c.path) ? pass(c.name) : fail(`${c.name} — ليس معفى`);
      continue;
    }
    const rule = ruleFor(c.path, c.method);
    const got = rule?.permission ?? null;
    got === c.expectPermission
      ? pass(`${c.name} ⇒ ${got ?? "رفضٌ افتراضيّ"}`)
      : fail(`${c.name} — توقّعتُ ${c.expectPermission} ووجدتُ ${got}`);
  }

  logger.info("== قراءةُ المبلغ والعدد من الجسم ==");
  readField({ amount: 50_000 }, "amount") === 50_000
    ? pass("المبلغ يُقرأ من `amount`")
    : fail("المبلغ لم يُقرأ");
  readField({ update: [1, 2, 3] }, "update.length") === 3
    ? pass("العدد يُقرأ من `update.length`")
    : fail("العدد لم يُقرأ");
  readField({}, "amount") === undefined
    ? pass("جسمٌ بلا مبلغ ⇒ لا سقفَ يُفحص")
    : fail("جسمٌ بلا مبلغ أعاد قيمة");

  // 🔴 التكامل: القاعدةُ + المصفوفة معاً على مسارٍ حقيقيّ
  logger.info("== الخريطة × المصفوفة (المسارُ الكامل) ==");
  const roles = await access.listRoles({});
  const roleBySlug = new Map(roles.map((r: any) => [r.slug, r]));
  const suffix = Date.now();

  const supportUser = `guard_support_${suffix}`;
  await access.createUserRoles({
    user_id: supportUser,
    role_id: (roleBySlug.get("support") as any).id,
  });

  const refundRule = ruleFor("/payments/pay_1/refund", "POST")!;

  const small = await access.can({
    user_id: supportUser,
    permission: refundRule.permission,
    amount: readField({ amount: 49_900 }, refundRule.amountField),
  });
  small.allowed
    ? pass("POST /payments/:id/refund بـ٤٩٩ ر.س ⇒ يمرّ")
    : fail("استردادٌ ضمن السقف رُفض");

  const big = await access.can({
    user_id: supportUser,
    permission: refundRule.permission,
    amount: readField({ amount: 50_100 }, refundRule.amountField),
  });
  !big.allowed && big.code === "LIMIT_EXCEEDED"
    ? pass("POST /payments/:id/refund بـ٥٠١ ر.س ⇒ LIMIT_EXCEEDED")
    : fail("استردادٌ فوق السقف مرّ");

  // ── 🔴 لوحةُ Medusa تعمل ──────────────────────────────────────
  // كشفَ فحصٌ بالمتصفّح في المرحلة ٨ أن ٢٩ مساراً من مسارات اللوحة
  // كانت تُردّ بـ403 **حتى لمديرٍ عام** — فكان الحارسُ يحرس متجراً لا
  // يُدار. وهذا يمنع تكرارَه.
  logger.info("== مساراتُ اللوحة لا تسقط في الرفض الافتراضيّ ==");
  const unmapped = ADMIN_CONSOLE_READS.filter(
    (p) => !isExempt(p) && ruleFor(p, "GET") === null
  );
  unmapped.length === 0
    ? pass(`${ADMIN_CONSOLE_READS.length} مساراً من مسارات اللوحة، لكلٍّ قاعدةٌ للقراءة`)
    : fail(`مساراتٌ تسقط في الرفض الافتراضيّ: ${unmapped.join(" · ")}`);

  // ولا تُخلط القراءةُ بالكتابة: `settings.read` للجميع
  // و`settings.manage` للمدير العام — وخلطُهما يجعل كلَّ موظّفٍ يغيّر
  // عملةَ المتجر.
  ruleFor("/regions", "GET")?.permission === "settings.read" &&
  ruleFor("/tax-rates", "POST")?.permission === "settings.manage"
    ? pass("وقراءةُ الإعدادات مفصولةٌ عن كتابتها")
    : fail("قراءةُ الإعدادات وكتابتُها على صلاحيةٍ واحدة");

  // ── تناسقُ الخريطة مع الصلاحيات المبذورة ───────────────────────
  // قاعدةٌ تشير إلى صلاحيةٍ غير موجودة تُغلق المسار على **الجميع**
  // بلا سبب — عطلٌ صامتٌ يظهر بشكوى «الزرّ لا يعمل لأحد».
  logger.info("== كلُّ قاعدةٍ تشير إلى صلاحيةٍ موجودة ==");
  const perms = new Set((await access.listPermissions({})).map((p: any) => p.slug));
  const orphans = [...new Set(ADMIN_ROUTE_RULES.map((r) => r.permission))].filter(
    (p) => !perms.has(p)
  );
  orphans.length === 0
    ? pass(`${ADMIN_ROUTE_RULES.length} قاعدةً، كلُّها تشير إلى صلاحياتٍ مبذورة`)
    : fail(`صلاحياتٌ في الخريطة بلا وجود: ${orphans.join(" · ")}`);

  const mine = (await access.listUserRoles({})).filter((u: any) =>
    String(u.user_id).includes(String(suffix))
  );
  if (mine.length) await access.deleteUserRoles(mine.map((u: any) => u.id));

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الحارس.`);
  logger.info("✅ كلُّ فحوص الحارس اجتازت.");
}
