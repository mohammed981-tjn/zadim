import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ACCESS_MODULE } from "../modules/access";
import type AccessModuleService from "../modules/access/service";

/**
 * بوّابةُ المرحلة ١ (07-roadmap.md).
 *
 * تثبت أن مصفوفة `05-rbac-matrix.md` **تُفرض فعلاً** — والأهمّ أنها
 * تثبت **رفضَ الممنوع** لا نجاحَ المسموح فقط: نجاحُ المسار السليم لا
 * يقول شيئاً عن كون المسار الفاسد مسدوداً.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-access.ts
 * المخرَج: صفرٌ إن نجح الكلّ، وغيرُ صفرٍ إن سقط واحد.
 */

type Expectation =
  | { expect: "allow" }
  | { expect: "deny"; code: "INSUFFICIENT_PERMISSION" | "LIMIT_EXCEEDED" };

type Case = Expectation & {
  name: string;
  role: string;
  permission: string;
  amount?: number;
  count?: number;
  vendor_id?: string | null;
};

const R = (sar: number) => sar * 100; // ريالاتٌ ⇒ هللات

const CASES: Case[] = [
  // ── الدعم: الحدُّ المالي ─────────────────────────────────────────
  { name: "الدعم يسترد ٤٩٩ ر.س", role: "support", permission: "payments.refund", amount: R(499), expect: "allow" },
  { name: "الدعم يسترد ٥٠٠ ر.س (على الحدّ)", role: "support", permission: "payments.refund", amount: R(500), expect: "allow" },
  { name: "الدعم يسترد ٥٠١ ر.س", role: "support", permission: "payments.refund", amount: R(501), expect: "deny", code: "LIMIT_EXCEEDED" },
  { name: "الدعم يصرف رصيد متجر ٢٠١ ر.س", role: "support", permission: "store_credit.issue", amount: R(201), expect: "deny", code: "LIMIT_EXCEEDED" },

  // ── المالية: بلا سقف ────────────────────────────────────────────
  { name: "المالية تسترد ١٠٠٬٠٠٠ ر.س", role: "finance", permission: "payments.refund", amount: R(100_000), expect: "allow" },
  { name: "المالية تقرأ تقرير الهامش", role: "finance", permission: "reports.margin", expect: "allow" },

  // ── فصلُ المسؤوليات ─────────────────────────────────────────────
  { name: "التسويق يغيّر سعراً", role: "marketing", permission: "products.price.update", expect: "deny", code: "INSUFFICIENT_PERMISSION" },
  { name: "مدير المنتجات يقرأ الهامش", role: "product", permission: "reports.margin", expect: "deny", code: "INSUFFICIENT_PERMISSION" },
  { name: "مدير التشغيل يسترد", role: "operations", permission: "payments.refund", expect: "deny", code: "INSUFFICIENT_PERMISSION" },
  { name: "الدعم يعدّل منتجاً", role: "support", permission: "products.write", expect: "deny", code: "INSUFFICIENT_PERMISSION" },
  { name: "المخزون يقرأ سجلّ التدقيق", role: "inventory", permission: "audit.read", expect: "deny", code: "INSUFFICIENT_PERMISSION" },

  // ── حدُّ العدد ──────────────────────────────────────────────────
  { name: "مدير المنتجات يعدّل ٥٠٠ صنفاً", role: "product", permission: "products.bulk_update", count: 500, expect: "allow" },
  { name: "مدير المنتجات يعدّل ٥٠١ صنفاً", role: "product", permission: "products.bulk_update", count: 501, expect: "deny", code: "LIMIT_EXCEEDED" },

  // ── الموافقة الثانية ────────────────────────────────────────────
  { name: "المخزون يسوّي جرداً منفرداً", role: "inventory", permission: "inventory.stocktake", expect: "deny", code: "LIMIT_EXCEEDED" },

  // ── المدير العام ────────────────────────────────────────────────
  { name: "المدير العام يسترد بلا سقف", role: "super_admin", permission: "payments.refund", amount: R(1_000_000), expect: "allow" },
  { name: "المدير العام يدير الأدوار", role: "super_admin", permission: "roles.manage", expect: "allow" },
];

export default async function verifyAccess({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const access = container.resolve<AccessModuleService>(ACCESS_MODULE);

  const roles = await access.listRoles({});
  const roleBySlug = new Map(roles.map((r: any) => [r.slug, r]));
  if (roleBySlug.size !== 7) {
    throw new Error(`[zadim] الأدوار ${roleBySlug.size} لا ٧. شغّل seed-access أولاً.`);
  }

  // مستخدمٌ اختباريّ لكل دور. يُنظَّف في النهاية.
  const suffix = Date.now();
  const userOf = new Map<string, string>();
  for (const [slug, role] of roleBySlug) {
    const userId = `verify_${slug}_${suffix}`;
    await access.createUserRoles({ user_id: userId, role_id: (role as any).id });
    userOf.set(slug, userId);
  }

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => { logger.error(`  ⛔ ${m}`); failures++; };

  logger.info("== مصفوفة الصلاحيات ==");
  for (const c of CASES) {
    const decision = await access.can({
      user_id: userOf.get(c.role)!,
      permission: c.permission,
      amount: c.amount,
      count: c.count,
      vendor_id: c.vendor_id,
    });

    if (c.expect === "allow") {
      decision.allowed ? pass(c.name) : fail(`${c.name} — رُفض بـ${(decision as any).code}`);
    } else if (decision.allowed) {
      fail(`${c.name} — مرّ وكان يجب أن يُرفض`);
    } else if (decision.code !== c.code) {
      fail(`${c.name} — رُفض بـ${decision.code} لا ${c.code}`);
    } else {
      pass(`${c.name} ⇒ ${decision.code}`);
    }
  }

  // ── حصرُ الدور ببائع (ADR-004) ─────────────────────────────────
  logger.info("== حصرُ الدور ببائع ==");
  const scopedUser = `verify_scoped_${suffix}`;
  await access.createUserRoles({
    user_id: scopedUser,
    role_id: (roleBySlug.get("support") as any).id,
    vendor_id: "vendor_A",
  });
  const own = await access.can({ user_id: scopedUser, permission: "orders.read", vendor_id: "vendor_A" });
  own.allowed ? pass("بائعٌ يقرأ طلباتِ نفسه") : fail("بائعٌ مُنع من طلباتِ نفسه");
  const other = await access.can({ user_id: scopedUser, permission: "orders.read", vendor_id: "vendor_B" });
  !other.allowed && other.code === "INSUFFICIENT_PERMISSION"
    ? pass("بائعٌ يقرأ طلباتِ بائعٍ آخر ⇒ INSUFFICIENT_PERMISSION")
    : fail("بائعٌ قرأ طلباتِ بائعٍ آخر");

  // ── بلا دور ────────────────────────────────────────────────────
  const nobody = await access.can({ user_id: `nobody_${suffix}`, permission: "orders.read" });
  !nobody.allowed ? pass("مستخدمٌ بلا دورٍ يُرفض") : fail("مستخدمٌ بلا دورٍ مرّ");

  // ── سجلّ التدقيق ───────────────────────────────────────────────
  logger.info("== سجلّ التدقيق ==");
  const entityId = `verify_${suffix}`;
  await access.record({
    actor_label: "محمد — مدير المنتجات",
    action: "product.price.update",
    entity: "product_variant",
    entity_id: entityId,
    old_value: { amount: 19900, currency: "SAR" },
    new_value: { amount: 17900, currency: "SAR" },
    ip: "127.0.0.1",
  });

  const [entry] = await access.listAuditLogs({ entity_id: entityId });
  entry && (entry as any).old_value?.amount === 19900 && (entry as any).new_value?.amount === 17900
    ? pass("القيمُ قبل (١٩٩٠٠) وبعد (١٧٩٠٠) محفوظتان")
    : fail("القيمُ قبل وبعد لم تُحفظ");

  // الخدمة ترمي صراحةً
  try {
    await (access as any).updateAuditLogs({ id: (entry as any).id, action: "x" });
    fail("الخدمة سمحت بتعديل سجلّ التدقيق");
  } catch {
    pass("الخدمة ترفض تعديل سجلّ التدقيق");
  }
  try {
    await (access as any).deleteAuditLogs([(entry as any).id]);
    fail("الخدمة سمحت بحذف سجلّ التدقيق");
  } catch {
    pass("الخدمة ترفض حذف سجلّ التدقيق");
  }

  // والقاعدة تمنعهما ولو تُخُطِّيت الخدمة — هذا هو الحارس الحقيقي.
  const knex = (access as any).__container__?.[ContainerRegistrationKeys.PG_CONNECTION]
    ?? container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  await knex.raw(`update "zadim_audit_log" set "action" = 'tampered' where "entity_id" = ?`, [entityId]);
  await knex.raw(`delete from "zadim_audit_log" where "entity_id" = ?`, [entityId]);
  const after = await knex.raw(
    `select "action" from "zadim_audit_log" where "entity_id" = ?`, [entityId]
  );
  const rows = after?.rows ?? after;
  rows?.length === 1 && rows[0].action === "product.price.update"
    ? pass("القاعدة نفسها ترفض UPDATE و DELETE — الصفُّ سليم")
    : fail(`القاعدة سمحت بالعبث: ${JSON.stringify(rows)}`);

  // ── تنظيف ──────────────────────────────────────────────────────
  const created = await access.listUserRoles({});
  const mine = created.filter((u: any) => String(u.user_id).includes(String(suffix)));
  if (mine.length) await access.deleteUserRoles(mine.map((u: any) => u.id));

  if (failures) {
    throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الصلاحيات.`);
  }
  logger.info("✅ كلُّ فحوص المرحلة ١ اجتازت.");
}
