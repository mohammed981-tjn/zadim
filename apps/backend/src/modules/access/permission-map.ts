/**
 * خريطةُ المسار ← الصلاحية.
 *
 * ── لماذا خريطةٌ في ملفٍ واحد لا فحصٌ داخل كل مسار ────────────────
 *
 * فحصُ الصلاحية داخل المُعالِج يعني أن **مساراً واحداً يُنسى فيه الفحص
 * يفتح باباً**، ولا أحد يعرف حتى يُستغلّ. وهذا الملف يجعل السؤال
 * معكوساً: المسارُ الذي لا يجد صلاحيتَه هنا **يُرفض افتراضاً**
 * (`deny-by-default`) — فالنسيانُ يُغلق الباب ولا يفتحه.
 *
 * والقائمةُ مقروءةٌ في مراجعةٍ واحدة، ويقابلها اختبارٌ يثبت أن كل
 * مسارٍ مذكورٍ هنا موجودٌ في `05-rbac-matrix.md` والعكس.
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteRule = {
  /** تعبيرٌ نمطيّ يطابق المسار بعد `/admin` */
  pattern: RegExp;
  methods: Method[];
  permission: string;
  /**
   * من أين يُقرأ المبلغ في الجسم حين يكون للصلاحية سقفٌ ماليّ.
   * غيابُه يعني «لا سقفَ يُفحص لهذا المسار».
   */
  amountField?: string;
  /** من أين يُقرأ العدد (دفعاتُ التعديل مثلاً) */
  countField?: string;
};

export const ADMIN_ROUTE_RULES: RouteRule[] = [
  // ── المنتجات ────────────────────────────────────────────────────
  // الأخصُّ أولاً — أوّلُ مطابقةٍ تفوز.
  { pattern: /^\/products\/batch$/, methods: ["POST"], permission: "products.bulk_update", countField: "update.length" },
  { pattern: /^\/products(\/|$)/, methods: ["GET"], permission: "products.read" },
  { pattern: /^\/products(\/[^/]+)?$/, methods: ["POST", "PUT", "PATCH"], permission: "products.write" },
  { pattern: /^\/products\/[^/]+$/, methods: ["DELETE"], permission: "products.delete" },
  { pattern: /^\/products\/[^/]+\/variants\/[^/]+\/prices?$/, methods: ["POST", "PATCH"], permission: "products.price.update" },
  { pattern: /^\/price-lists(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "products.price.update" },

  // ── المخزون ─────────────────────────────────────────────────────
  { pattern: /^\/inventory-items(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/inventory-items(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "inventory.adjust" },
  { pattern: /^\/stock-locations(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/stock-locations(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "locations.manage" },

  // ── الطلبات ─────────────────────────────────────────────────────
  { pattern: /^\/orders(\/|$)/, methods: ["GET"], permission: "orders.read" },
  { pattern: /^\/orders\/[^/]+\/cancel$/, methods: ["POST"], permission: "orders.cancel" },
  { pattern: /^\/orders\/[^/]+\/edit(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "orders.edit_items" },
  { pattern: /^\/orders\/[^/]+\/fulfillments(\/|$)/, methods: ["POST"], permission: "fulfilment.ship" },

  // ── المال ───────────────────────────────────────────────────────
  { pattern: /^\/payments(\/|$)/, methods: ["GET"], permission: "payments.read" },
  { pattern: /^\/payments\/[^/]+\/capture$/, methods: ["POST"], permission: "payments.capture" },
  // 🔴 السقفُ المالي يُقرأ من الجسم. وغيابُ `amountField` هنا يعني
  // استرداداً بلا سقف — وهو بالضبط ما تمنعه المصفوفة.
  { pattern: /^\/payments\/[^/]+\/refund$/, methods: ["POST"], permission: "payments.refund", amountField: "amount" },

  // ── المرتجعات ───────────────────────────────────────────────────
  { pattern: /^\/returns(\/|$)/, methods: ["GET"], permission: "orders.read" },
  { pattern: /^\/returns\/[^/]+\/(confirm|request)$/, methods: ["POST"], permission: "returns.approve" },
  { pattern: /^\/returns\/[^/]+\/receive(\/|$)/, methods: ["POST"], permission: "returns.inspect" },

  // ── الشحن ───────────────────────────────────────────────────────
  { pattern: /^\/shipping-options(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "shipping.rates.manage" },
  { pattern: /^\/fulfillment-sets(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "shipping.rates.manage" },

  // ── التسويق ─────────────────────────────────────────────────────
  { pattern: /^\/promotions(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "promotions.manage" },
  { pattern: /^\/campaigns(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "coupons.manage" },

  // ── وحدة catalog ────────────────────────────────────────────────
  // الخصائصُ جزءٌ من الكتالوج: من يملك المنتجات يملكها. والمرادفاتُ
  // أداةُ تسويقٍ وبحث — بيتُها عند مدير التسويق لا عند مدير المنتجات،
  // فهو من يقرأ تقرير «بحثٌ بلا نتيجة».
  { pattern: /^\/catalog\/attributes(\/|$)/, methods: ["GET"], permission: "products.read" },
  { pattern: /^\/catalog\/attributes(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "products.write" },
  { pattern: /^\/catalog\/images(\/|$)/, methods: ["POST"], permission: "products.write" },
  // SEO والتحويلاتُ أدواتُ تسويقٍ وبحث: بيتُها عند مدير التسويق —
  // وتغييرُ عنوانِ صفحةٍ في جوجل قرارُ حملةٍ لا قرارُ كتالوج.
  { pattern: /^\/catalog\/seo(\/|$)/, methods: ["GET"], permission: "products.read" },
  { pattern: /^\/catalog\/seo(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "cms.manage" },
  { pattern: /^\/catalog\/redirects(\/|$)/, methods: ["GET"], permission: "products.read" },
  { pattern: /^\/catalog\/redirects(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "cms.manage" },
  { pattern: /^\/catalog\/synonyms(\/|$)/, methods: ["GET"], permission: "products.read" },
  { pattern: /^\/catalog\/synonyms(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "cms.manage" },

  // ── وحدة warehouse ──────────────────────────────────────────────
  // الدفترُ **للقراءة فقط**: لا مسارَ كتابةٍ له أصلاً — يكتبه مُطلِقُ
  // القاعدة. ولو وُجد مسارٌ لكان بابَ تزويرٍ في السجلّ الذي يُحتكم إليه.
  { pattern: /^\/warehouse\/movements(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/warehouse\/alerts(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  // الحدُّ يضبطه من يملك المستودعات: رفعُه يُسكت تنبيهاً، وخفضُه يُغرق
  // الفريقَ بتنبيهاتٍ فيتجاهلها — كلاهما قرارُ تشغيلٍ لا قرارُ قراءة.
  { pattern: /^\/warehouse\/alert-rules(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/warehouse\/alert-rules(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "locations.manage" },
  { pattern: /^\/warehouse\/profiles(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/warehouse\/profiles(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "locations.manage" },
  // معاينةُ الخطة قراءةٌ لا تحجز شيئاً — لكنها تكشف توزّعَ المخزون على
  // المستودعات، وذاك ما لا يُعرض لمن لا يقرأ المخزون أصلاً.
  { pattern: /^\/warehouse\/allocate(\/|$)/, methods: ["POST"], permission: "inventory.read" },

  // ── وحدة orders ─────────────────────────────────────────────────
  // كلاهما **قراءةٌ فقط**: جدولُ الانتقالات يُغيَّر بهجرةٍ تُراجَع لا
  // بنداءٍ من لوحة، وصندوقُ الأحداث يكتبه مُطلِقُ القاعدة — ومسارُ
  // كتابةٍ له بابُ تزويرٍ في سجلّ «ماذا وقع ومتى».
  { pattern: /^\/order-flow\/(transitions|outbox)(\/|$)/, methods: ["GET"], permission: "orders.read" },

  // ── وحدتا payments و zatca ──────────────────────────────────────
  // السياسةُ إعدادُ متجرٍ لا قرارُ طلب: حدُّ COD يوازن بيعاً بشحنتين،
  // ويضبطه من يملك إعدادات المتجر. **والرفضةُ واقعةُ تشغيل** يقيّدها من
  // يتابع الطلبات — ولا مسارَ لحذفها أصلاً.
  { pattern: /^\/payments\/cod-policy(\/|$)/, methods: ["GET"], permission: "payments.read" },
  { pattern: /^\/payments\/cod-policy(\/|$)/, methods: ["POST", "PATCH"], permission: "settings.manage" },
  { pattern: /^\/payments\/cod-refusals(\/|$)/, methods: ["GET"], permission: "payments.read" },
  { pattern: /^\/payments\/cod-refusals(\/|$)/, methods: ["POST"], permission: "orders.edit_items" },
  // الفواتيرُ سجلٌّ ماليّ: تُقرأ بصلاحية المال. **ولا مسارَ إصدارٍ
  // يدويّ** — الإصدارُ يقع مع الطلب تحت قفلٍ يُسلسل التسلسل.
  { pattern: /^\/zatca\/invoices(\/|$)/, methods: ["GET"], permission: "payments.read" },
  { pattern: /^\/zatca\/settings(\/|$)/, methods: ["GET"], permission: "payments.read" },
  { pattern: /^\/zatca\/settings(\/|$)/, methods: ["POST", "PATCH"], permission: "settings.manage" },

  // ── وحدة fulfilment (شاشاتُ المستودع) ───────────────────────────
  // اللقطُ والتغليفُ صلاحيتان منفصلتان لأنهما شخصان مختلفان في المستودع:
  // من يلقط لا يغلّف، ومن يغلّف لا يفتح قوائمَ لقطٍ ليست له.
  { pattern: /^\/fulfilment\/pick-lists(\/|$)/, methods: ["GET", "POST"], permission: "fulfilment.pick" },
  { pattern: /^\/fulfilment\/parcels(\/|$)/, methods: ["GET", "POST"], permission: "fulfilment.pack" },

  // ── وحدة access نفسها ───────────────────────────────────────────
  { pattern: /^\/access\/roles(\/|$)/, methods: ["GET"], permission: "roles.manage" },
  { pattern: /^\/access\/roles(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "roles.manage" },
  { pattern: /^\/access\/assignments(\/|$)/, methods: ["GET", "POST", "DELETE"], permission: "users.manage" },
  { pattern: /^\/access\/audit(\/|$)/, methods: ["GET"], permission: "audit.read" },

  // ── النظام ──────────────────────────────────────────────────────
  { pattern: /^\/users(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "users.manage" },
  { pattern: /^\/api-keys(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "settings.manage" },
  { pattern: /^\/sales-channels(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "settings.manage" },
  { pattern: /^\/store(\/|$)/, methods: ["POST", "PUT", "PATCH"], permission: "settings.manage" },
  { pattern: /^\/tax-(regions|rates)(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "settings.manage" },
];

/**
 * مساراتٌ لا تحتاج صلاحية — قائمةٌ مغلقةٌ ومُبرَّرة، لا استثناءاتٌ
 * تُضاف كلما ضاق مبرمجٌ بالحارس.
 */
export const EXEMPT: RegExp[] = [
  /^\/auth(\/|$)/,       // الدخول نفسه: لا يُحرَس بصلاحيةٍ يحملها من لم يدخل بعد
  /^\/invites(\/|$)/,    // قبولُ الدعوة يسبق وجودَ الدور
  /^\/users\/me$/,       // «من أنا» — لا يكشف إلا صاحبَه
  /^\/uploads$/,         // الرفعُ محروسٌ بالمسار الذي يستهلكه
];

/**
 * **أوّلُ مطابقةٍ تفوز** — فالترتيبُ في المصفوفة أعلاه ليس تجميلاً بل
 * جزءٌ من التعريف: الأخصُّ يُكتب قبل الأعمّ.
 *
 * وكان هنا ترجيحٌ بـ«أطولِ نمطٍ يفوز»، فأخطأ: نمط `/^\/products\/batch$/`
 * أقصرُ نصّاً من `/^\/products(\/[^/]+)?$/` وإن كان أخصَّ معنى — فوقعت
 * دفعةُ المنتجات تحت `products.write` بدل `products.bulk_update`،
 * **وتجاوزت حدَّ الخمسمئة صنف صامتةً**. كشفه اختبارُ الحارس.
 *
 * والدرس: حيلةٌ ذكيّة تُخمّن الأخصّ أسوأُ من ترتيبٍ صريحٍ يُقرأ.
 */
export function ruleFor(path: string, method: string): RouteRule | null {
  const m = method.toUpperCase() as Method;
  return (
    ADMIN_ROUTE_RULES.find((r) => r.methods.includes(m) && r.pattern.test(path)) ?? null
  );
}

export function isExempt(path: string): boolean {
  return EXEMPT.some((p) => p.test(path));
}

/** يقرأ `update.length` و`amount` ونحوَهما من جسم الطلب. */
export function readField(body: unknown, field?: string): number | undefined {
  if (!field || !body || typeof body !== "object") return undefined;
  let cur: any = body;
  for (const part of field.split(".")) {
    if (cur == null) return undefined;
    cur = part === "length" && Array.isArray(cur) ? cur.length : cur[part];
  }
  return typeof cur === "number" ? cur : undefined;
}
