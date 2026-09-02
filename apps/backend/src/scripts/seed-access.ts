import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ACCESS_MODULE } from "../modules/access";
import type AccessModuleService from "../modules/access/service";

/**
 * بذرُ الصلاحيات والأدوار السبعة وحدودِها — مصفوفة `05-rbac-matrix.md`
 * منقولةً إلى القاعدة.
 *
 * والحدود **بيانات** (بند ٤٨): سقفُ استرداد الدعم ٥٠٠ ر.س يرفعه المدير
 * العام حين يثق ويخفضه حين يشكّ. لا رقمَ منها في الكود.
 *
 * والسكربت **مُتماثلٌ عند الإعادة** (idempotent): يُشغَّل مرّتين فلا
 * يُضاعف شيئاً — بذرةٌ تُضاعف الأدوار عند إعادة النشر عطلٌ صامت.
 *
 * التشغيل: npx medusa exec ./src/scripts/seed-access.ts
 */

const PERMISSIONS: Array<[slug: string, domain: string, description: string]> = [
  // الكتالوج
  ["products.read", "products", "قراءة المنتجات"],
  ["products.write", "products", "إنشاء المنتجات وتعديلها"],
  ["products.price.update", "products", "تغيير الأسعار"],
  ["products.bulk_update", "products", "التعديل بالدفعات"],
  ["products.delete", "products", "حذف المنتجات"],
  // المخزون
  ["inventory.read", "inventory", "قراءة المخزون"],
  ["inventory.adjust", "inventory", "تسوية المخزون"],
  ["inventory.stocktake", "inventory", "الجرد"],
  ["locations.manage", "inventory", "إدارة المستودعات"],
  // الطلبات
  ["orders.read", "orders", "قراءة الطلبات"],
  ["orders.edit_items", "orders", "تعديل بنود الطلب"],
  ["orders.cancel", "orders", "إلغاء الطلب"],
  // التنفيذ
  ["fulfilment.pick", "fulfilment", "اللقط"],
  ["fulfilment.pack", "fulfilment", "التغليف"],
  ["fulfilment.ship", "fulfilment", "الشحن"],
  ["shipping.rates.manage", "fulfilment", "إدارة أجور الشحن"],
  // المال
  ["payments.read", "payments", "قراءة المدفوعات"],
  ["payments.capture", "payments", "التحصيل"],
  ["payments.refund", "payments", "الاسترداد"],
  ["store_credit.issue", "payments", "إصدار رصيد متجر"],
  // المرتجعات
  ["returns.approve", "returns", "قبول المرتجع ورفضه"],
  ["returns.inspect", "returns", "فحص الراجع"],
  // التسويق
  ["promotions.manage", "marketing", "إدارة العروض"],
  ["coupons.manage", "marketing", "إدارة الكوبونات"],
  ["cms.manage", "marketing", "إدارة المحتوى"],
  ["campaigns.send", "marketing", "إرسال الحملات"],
  // الشراء
  ["suppliers.manage", "purchasing", "إدارة الموردين"],
  ["purchase_orders.create", "purchasing", "إنشاء أوامر الشراء"],
  ["purchase_orders.approve", "purchasing", "اعتماد أوامر الشراء"],
  // التقارير
  ["reports.sales", "reports", "تقارير المبيعات"],
  ["reports.margin", "reports", "تقرير الهامش والتكلفة"],
  // إعداداتُ المتجر — قراءةٌ محايدة
  ["settings.read", "system", "قراءةُ إعدادات المتجر العامّة (المناطق والعملات والقنوات وأجور الشحن)"],
  // النظام
  ["users.manage", "system", "إدارة المستخدمين"],
  ["roles.manage", "system", "إدارة الأدوار"],
  ["audit.read", "system", "قراءة سجلّ التدقيق"],
  ["settings.manage", "system", "إدارة الإعدادات"],
];

type LimitSpec = {
  permission_slug: string;
  max_amount?: number | null;   // هللات
  max_count?: number | null;
  requires_second_approval?: boolean;
};

const ROLES: Array<{
  slug: string;
  name_ar: string;
  permissions: string[] | "*";
  limits?: LimitSpec[];
}> = [
  {
    slug: "super_admin",
    name_ar: "مدير عام",
    permissions: "*",
  },
  {
    slug: "operations",
    name_ar: "مدير التشغيل",
    permissions: [
      "settings.read",
      "products.read", "inventory.read", "orders.read", "orders.edit_items",
      "orders.cancel", "fulfilment.pick", "fulfilment.pack", "fulfilment.ship",
      "shipping.rates.manage", "payments.read", "payments.capture",
      "returns.approve", "reports.sales",
    ],
  },
  {
    slug: "inventory",
    name_ar: "مدير المخزون",
    permissions: [
      "settings.read",
      "products.read", "inventory.read", "inventory.adjust", "inventory.stocktake",
      "locations.manage", "orders.read", "fulfilment.pick", "fulfilment.pack",
      "fulfilment.ship", "returns.inspect", "suppliers.manage",
      "purchase_orders.create",
    ],
    limits: [
      // تسويةٌ منفردة أسهلُ طريقةٍ لإخفاء سرقةٍ من المستودع: تنقص
      // الكمية ويُقيَّد «فرقُ جرد». فالموافقةُ الثانية ليست بيروقراطية.
      { permission_slug: "inventory.stocktake", requires_second_approval: true },
    ],
  },
  {
    slug: "product",
    name_ar: "مدير المنتجات",
    permissions: [
      "settings.read",
      "products.read", "products.write", "products.price.update",
      "products.bulk_update", "inventory.read", "reports.sales",
    ],
    limits: [
      // خطأٌ في دفعةٍ كبيرة يفسد الكتالوج كلَّه، والحدُّ يُبقي التراجع ممكناً.
      { permission_slug: "products.bulk_update", max_count: 500 },
    ],
  },
  {
    slug: "marketing",
    name_ar: "مدير التسويق",
    permissions: [
      "settings.read",
      "products.read", "promotions.manage", "coupons.manage", "cms.manage",
      "campaigns.send", "reports.sales",
    ],
    limits: [
      { permission_slug: "campaigns.send", max_count: 1000 },
    ],
  },
  {
    slug: "support",
    name_ar: "موظف الدعم",
    permissions: [
      "settings.read",
      "products.read", "inventory.read", "orders.read", "orders.cancel",
      "payments.read", "payments.refund", "store_credit.issue", "returns.approve",
    ],
    limits: [
      // أكثرُ شكاوى العملاء صغيرةٌ ويجب أن تُحلّ فوراً بلا تصعيد. والحدُّ
      // يمنع أن يصير حسابُ دعمٍ مسروق بوّابةَ نزفٍ للخزينة.
      { permission_slug: "payments.refund", max_amount: 50_000 },   // ٥٠٠ ر.س
      { permission_slug: "store_credit.issue", max_amount: 20_000 }, // ٢٠٠ ر.س
    ],
  },
  {
    slug: "finance",
    name_ar: "المالية",
    permissions: [
      "settings.read",
      "orders.read", "inventory.read", "payments.read", "payments.capture",
      "payments.refund", "store_credit.issue", "purchase_orders.approve",
      "reports.sales", "reports.margin", "audit.read",
    ],
    // بلا حدود: المالية تسترد بلا سقف. وفصلُ من يُلغي عن من يصرف المال
    // مقصود — تركيزُهما في يدٍ واحدة يُنشئ مسارَ اختلاسٍ كامل.
  },
];

/**
 * سياساتُ تحديد المعدّل الافتراضية (المرحلة ١٥).
 *
 * ⚠️ **هذه بذورٌ لا ثوابت**: تُكتب مرّةً إن غابت، ولا تُكتب فوق ما
 * عدّله المدير. فمن ضبط رقماً في اللوحة لا تُعيده نشرةٌ تالية إلى
 * الافتراض — وذاك صنفُ العطب الذي لا يُلاحَظ إلا بعد الهجوم.
 *
 * والأرقامُ أدناه **نقطةُ بدءٍ محافظة**، تُضبط بالمشاهدة بعد الإطلاق.
 */
const RATE_LIMITS: Array<{
  name: string;
  path_prefix: string;
  methods: string;
  window_seconds: number;
  max_requests: number;
  scope_by: "ip" | "actor" | "ip_actor";
}> = [
  {
    // 🔴 الأهمّ في الجدول. حشوُ بيانات الاعتماد يجرّب آلافاً في
    // الدقيقة، وعشرٌ تكفي إنساناً نسي كلمته — الفرق بين الاثنين
    // ثلاثةُ أوامرِ قدر، فلا يحتاج الحدُّ دقّةً ليعمل.
    name: "auth_attempts",
    path_prefix: "/auth",
    methods: "POST",
    window_seconds: 60,
    max_requests: 10,
    scope_by: "ip",
  },
  {
    // إنشاءُ الطلبات والسلال: أضيقُ من التصفّح لأن كلَّ واحدٍ منها
    // يكتب في القاعدة ويحجز مخزوناً.
    name: "store_writes",
    path_prefix: "/store",
    methods: "POST,PUT,PATCH,DELETE",
    window_seconds: 60,
    max_requests: 60,
    scope_by: "ip",
  },
  {
    // التصفّحُ كريمٌ عمداً: زائرٌ يفتح عشر صفحاتٍ في دقيقةٍ سلوكٌ
    // طبيعيّ، وحدٌّ ضيّقٌ هنا يخنق البيع لا الحاصد.
    name: "store_reads",
    path_prefix: "/store",
    methods: "GET",
    window_seconds: 60,
    max_requests: 300,
    scope_by: "ip",
  },
  {
    // الإدارةُ بالهوية لا بالعنوان: فريقٌ كاملٌ خلف عنوانٍ واحدٍ في
    // المكتب لا يجوز أن يتقاسم حدّاً واحداً.
    name: "admin_all",
    path_prefix: "/admin",
    methods: "*",
    window_seconds: 60,
    max_requests: 600,
    scope_by: "ip_actor",
  },
];

export default async function seedAccess({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const access = container.resolve<AccessModuleService>(ACCESS_MODULE);

  // ── الصلاحيات ──────────────────────────────────────────────────
  const existingPerms = await access.listPermissions({});
  const permBySlug = new Map(existingPerms.map((p: any) => [p.slug, p]));

  const missingPerms = PERMISSIONS.filter(([slug]) => !permBySlug.has(slug));
  if (missingPerms.length) {
    const created = await access.createPermissions(
      missingPerms.map(([slug, domain, description]) => ({ slug, domain, description }))
    );
    for (const p of [created].flat() as any[]) permBySlug.set(p.slug, p);
  }
  logger.info(`الصلاحيات: ${permBySlug.size} (جديدة: ${missingPerms.length})`);

  // ── الأدوار ────────────────────────────────────────────────────
  const existingRoles = await access.listRoles({}, { relations: ["limits"] });
  const roleBySlug = new Map(existingRoles.map((r: any) => [r.slug, r]));

  for (const spec of ROLES) {
    const permIds = (spec.permissions === "*"
      ? [...permBySlug.values()]
      : spec.permissions.map((s) => {
          const p = permBySlug.get(s);
          // بذرةٌ تشير إلى صلاحيةٍ غير موجودة عطلُ إعدادٍ لا حالةٌ تُتجاوز:
          // دورٌ ينقصه إذنٌ يظهر بعد أشهرٍ بشكوى «الزر لا يعمل».
          if (!p) throw new Error(`[zadim] الصلاحية «${s}» غير معرّفة للدور «${spec.slug}»`);
          return p;
        })
    ).map((p: any) => p.id);

    let role: any = roleBySlug.get(spec.slug);
    if (!role) {
      role = await access.createRoles({
        slug: spec.slug,
        name_ar: spec.name_ar,
        is_system: true,
        permissions: permIds,
      });
      role = [role].flat()[0];
      roleBySlug.set(spec.slug, role);
    } else {
      await access.updateRoles({
        id: role.id,
        name_ar: spec.name_ar,
        permissions: permIds,
      });
    }

    // ── الحدود ───────────────────────────────────────────────────
    const currentLimits = await access.listRoleLimits({ role_id: role.id });
    const byPerm = new Map(currentLimits.map((l: any) => [l.permission_slug, l]));

    for (const limit of spec.limits ?? []) {
      const payload = {
        role_id: role.id,
        permission_slug: limit.permission_slug,
        max_amount: limit.max_amount ?? null,
        max_count: limit.max_count ?? null,
        requires_second_approval: limit.requires_second_approval ?? false,
      };
      const existing = byPerm.get(limit.permission_slug) as any;
      if (existing) await access.updateRoleLimits({ id: existing.id, ...payload });
      else await access.createRoleLimits(payload);
    }
  }

  logger.info(`الأدوار: ${roleBySlug.size} — ${[...roleBySlug.keys()].join(" · ")}`);

  // ── سياساتُ تحديد المعدّل ────────────────────────────────────────
  const existingPolicies = await access.listRateLimitPolicies(
    {},
    { select: ["id", "name"] }
  );
  const policyNames = new Set(existingPolicies.map((p: any) => p.name));
  const missingPolicies = RATE_LIMITS.filter((p) => !policyNames.has(p.name));
  if (missingPolicies.length) {
    await access.createRateLimitPolicies(missingPolicies);
  }
  logger.info(
    `سياساتُ الحدّ: ${policyNames.size + missingPolicies.length} (جديدة: ${missingPolicies.length})`
  );

  logger.info("✅ بذرُ الصلاحيات تمّ.");
}
