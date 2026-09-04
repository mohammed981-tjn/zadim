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
   *
   * 🔴 ووجودُه يعني أن المبلغ **لازمٌ**: مسارٌ يعلن سقفاً ولا يُقرأ له
   * مبلغٌ يُرفض في `middlewares.ts` ولا يمرّ بلا سقف. انظر تعليقَه هناك.
   */
  amountField?: string;
  /**
   * من أين تُقرأ الأعدادُ (دفعاتُ التعديل مثلاً) — **قائمةٌ لا حقلٌ واحد**.
   *
   * وكان حقلاً واحداً (`update.length`)، وفيه فجوةٌ: دفعةُ منتجاتٍ
   * بـ`create` من خمسة آلاف صنفٍ لا `update` فيها **تمرّ بلا عدٍّ** —
   * فالحقلُ المعلَن غائبٌ عن الجسم، والسقفُ لا يُفحص. والحكمُ يقع على
   * **أكبرِ** ما يُقرأ من هذه الحقول، فالدفعةُ تُقاس بأثقلِ أذرعها.
   */
  countFields?: string[];
};

export const ADMIN_ROUTE_RULES: RouteRule[] = [
  // ── المنتجات ────────────────────────────────────────────────────
  // الأخصُّ أولاً — أوّلُ مطابقةٍ تفوز.
  { pattern: /^\/products\/batch$/, methods: ["POST"], permission: "products.bulk_update", countFields: ["create.length", "update.length", "delete.length"] },
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

  // ── وحدة returns (المرحلة ١٠) ───────────────────────────────────
  //
  // تحت `returns-flow` لا `returns`: الثاني يملكه Medusa، و`policy` قد
  // يُلتقط معرّفاً — نفسُ سببِ `order-flow` في المرحلة ٥.
  //
  // والسياسةُ يقرؤها من يقرأ الطلبات (الدعمُ يخبر العميلَ بالمدّة)،
  // **ويضبطها من يملك المرتجعاتِ وحدَه**: تضييقُ النافذة قرارُ تاجرٍ
  // بأثرٍ ماليّ، لا إعدادُ عرض.
  { pattern: /^\/returns-flow\/policy(\/|$)/, methods: ["GET"], permission: "orders.read" },
  { pattern: /^\/returns-flow\/policy(\/|$)/, methods: ["POST"], permission: "returns.approve" },
  { pattern: /^\/returns-flow\/inspections(\/|$)/, methods: ["GET"], permission: "orders.read" },
  { pattern: /^\/returns-flow\/inspections(\/|$)/, methods: ["POST"], permission: "returns.inspect" },

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
  // والترجمةُ نصٌّ يراه الزبون كما يراه في المدوّنة والـSEO — فبيتُها
  // `cms.manage` لا `products.write`: من يكتب لغةَ المتجر ليس بالضرورة
  // من يضبط أسعارَه ومخزونَه.
  { pattern: /^\/catalog\/translations(\/|$)/, methods: ["GET"], permission: "products.read" },
  { pattern: /^\/catalog\/translations(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "cms.manage" },

  // ── مراجعةُ التقييمات (بند ٢٣) ─────────────────────────────────
  // نصٌّ يكتبه الجمهورُ ويُعرض على صفحةٍ تُفهرَس — فهو محتوى، وبيتُه
  // `cms.manage` عند من يكتب لغةَ المتجر. **لا `products.write`**:
  // نشرُ رأيٍ في منتجٍ ليس تغييرَ سعره ولا مخزونِه، ومن يضبط الكتالوج
  // ليس بالضرورة من يحكم على نصٍّ يقرؤه الجمهور.
  { pattern: /^\/reviews(\/|$)/, methods: ["GET"], permission: "cms.manage" },
  { pattern: /^\/reviews(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "cms.manage" },

  // ── وحدة warehouse ──────────────────────────────────────────────
  // الدفترُ **للقراءة فقط**: لا مسارَ كتابةٍ له أصلاً — يكتبه مُطلِقُ
  // القاعدة. ولو وُجد مسارٌ لكان بابَ تزويرٍ في السجلّ الذي يُحتكم إليه.
  { pattern: /^\/warehouse\/movements(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/warehouse\/alerts(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  // الحدُّ يضبطه من يملك المستودعات: رفعُه يُسكت تنبيهاً، وخفضُه يُغرق
  // الفريقَ بتنبيهاتٍ فيتجاهلها — كلاهما قرارُ تشغيلٍ لا قرارُ قراءة.
  { pattern: /^\/warehouse\/alert-rules(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/warehouse\/alert-rules(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "locations.manage" },
  // ── تسوياتُ المخزون — **والموافقةُ صلاحيةٌ أخرى** ──────────────
  //
  // 🔴 `inventory.adjust` يطلب، و`inventory.stocktake` يوافق ويطبّق.
  // وتركيزُهما في صلاحيةٍ واحدةٍ يجعل «أربعُ عيونٍ» عبارةً في وثيقة:
  // من يملك الاثنين يطلب ويوافق على نفسه — والقيدُ في القاعدة يمنع
  // ذلك بالهويّة، والصلاحيةُ تمنعه بالدور. **وطبقتان لا واحدة.**
  { pattern: /^\/warehouse\/adjustments\/[^/]+\/(approve|apply)(\/|$)/, methods: ["POST"], permission: "inventory.stocktake" },
  { pattern: /^\/warehouse\/adjustments(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/warehouse\/adjustments(\/|$)/, methods: ["POST"], permission: "inventory.adjust" },
  { pattern: /^\/warehouse\/adjustment-policy(\/|$)/, methods: ["GET"], permission: "settings.read" },
  { pattern: /^\/warehouse\/adjustment-policy(\/|$)/, methods: ["PATCH", "POST"], permission: "settings.manage" },
  { pattern: /^\/warehouse\/profiles(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/warehouse\/profiles(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "locations.manage" },
  // معاينةُ الخطة قراءةٌ لا تحجز شيئاً — لكنها تكشف توزّعَ المخزون على
  // المستودعات، وذاك ما لا يُعرض لمن لا يقرأ المخزون أصلاً.
  { pattern: /^\/warehouse\/allocate(\/|$)/, methods: ["POST"], permission: "inventory.read" },

  // ── وحدة notify — سجلُّ التسليم وسياسةُ الإعادة ─────────────────
  //
  // 🔴 والسجلُّ تحت `audit.read` لا `settings.read`: هو دفترُ وقائعَ
  // عن عملاءَ بأعيانهم — من راسلناه ومتى وبأيّ نتيجة. ومن لا يُؤتمن
  // على سجلّ التدقيق لا يُؤتمن عليه. (والعناوينُ مقنَّعةٌ فيه أصلاً،
  // فالصلاحيةُ طبقةٌ ثانيةٌ لا وحيدة.)
  { pattern: /^\/notifications\/log(\/|$)/, methods: ["GET"], permission: "audit.read" },
  { pattern: /^\/notifications\/policy(\/|$)/, methods: ["GET"], permission: "settings.read" },
  { pattern: /^\/notifications\/policy(\/|$)/, methods: ["PATCH", "POST"], permission: "settings.manage" },

  // ── وحدة procurement (بندا ٣٢ و٣٣) ──────────────────────────────
  //
  // 🔴 والفصلُ هنا مقصودٌ ومكتوبٌ في `05-rbac-matrix.md`: **من يُصدر
  // الأمرَ ليس من يعتمده**. مديرُ المخزون ينشئ ويستلم، والمالية تعتمد.
  // وتركيزُهما في يدٍ واحدة يجعل «اشترِ من نفسك» مساراً كاملاً: أمرٌ
  // يُنشأ ويُعتمد ويُستلَم بلا عينٍ ثانية.
  //
  // ⚠️ و**الاستلامُ تحت `inventory.adjust` لا تحت `purchase_orders`**:
  // هو تغييرُ مخزونٍ حقيقيٍّ على الرفّ، ومن لا يُؤتمن على التسوية لا
  // يُؤتمن على أن يقول «وصلت مئةٌ» وهي تسعون.
  { pattern: /^\/procurement\/suppliers(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/procurement\/suppliers(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "suppliers.manage" },
  { pattern: /^\/procurement\/purchase-orders\/[^/]+\/receive(\/|$)/, methods: ["POST"], permission: "inventory.adjust" },
  { pattern: /^\/procurement\/purchase-orders\/[^/]+\/place(\/|$)/, methods: ["POST"], permission: "purchase_orders.approve" },
  { pattern: /^\/procurement\/purchase-orders(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/procurement\/purchase-orders(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "purchase_orders.create" },

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

  // ── اللوحة والدفعات ─────────────────────────────────────────────
  // أرقامُ اللوحة تكشف المبيعاتِ والمخزون: تُقرأ بصلاحية التقارير.
  { pattern: /^\/dashboard\/metrics(\/|$)/, methods: ["GET"], permission: "reports.sales" },
  // والدفعةُ تحت **نفس سقف** `products.bulk_update` من المرحلة ١ — لا
  // رقمَ ثانٍ في مسارٍ ثانٍ يفترق عنه يومَ يرفع المالكُ السقف.
  { pattern: /^\/bulk\/[^/]+\/revert$/, methods: ["POST"], permission: "products.bulk_update" },
  { pattern: /^\/bulk\/product-price$/, methods: ["POST"], permission: "products.bulk_update", countFields: ["variant_ids.length"] },
  { pattern: /^\/bulk(\/|$)/, methods: ["GET"], permission: "products.read" },

  // ── وحدة cms ────────────────────────────────────────────────────
  // ترتيبُ الرئيسية قرارُ تسويقٍ لا قرارُ كتالوج: من يدير المحتوى
  // يرتّبها — وهو من يعرف ما يُقدَّم في الموسم.
  { pattern: /^\/cms\/blocks(\/|$)/, methods: ["GET"], permission: "products.read" },
  { pattern: /^\/cms\/blocks(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "cms.manage" },

  // ── وحدة access نفسها ───────────────────────────────────────────
  { pattern: /^\/access\/roles(\/|$)/, methods: ["GET"], permission: "roles.manage" },
  { pattern: /^\/access\/roles(\/|$)/, methods: ["POST", "PATCH", "DELETE"], permission: "roles.manage" },
  { pattern: /^\/access\/assignments(\/|$)/, methods: ["GET", "POST", "DELETE"], permission: "users.manage" },
  { pattern: /^\/access\/audit(\/|$)/, methods: ["GET"], permission: "audit.read" },

  // ── 🔴 قراءةُ اللوحة — ما تناديه شاشاتُ Medusa نفسُها ──────────────
  //
  // كشفَه فحصٌ بالمتصفّح في المرحلة ٨، ولم تكشفه سبعُ مراحلَ من فحوص
  // `curl`: كلُّها كانت تنادي **مساراتِنا** فتمرّ، ولوحةُ Medusa تنادي
  // تسعةً وعشرين مساراً غيرَها **فتُردّ كلُّها بـ403** — حتى لمديرٍ عام.
  // فالحارسُ كان يحرس متجراً لا يستطيع أحدٌ إدارتَه.
  //
  // والعلاجُ **ليس فتحَ القراءة كلِّها**: كلُّ قراءةٍ تسكن مع نطاقها،
  // فمن يقرأ الطلبات يقرأ عملاءها، ومن يقرأ المنتجات يقرأ تصنيفاتها.
  // ولا يبقى بلا نطاقٍ إلا **الإعداداتُ المحايدة** — المناطقُ والعملاتُ
  // والقنواتُ وأجورُ الشحن — وهي ما يظهر في كل مُنتقٍ في كل شاشة،
  // فأُفردت لها `settings.read` **الممنوحةُ لكل الأدوار**.
  //
  // ⚠️ ولاحظ الفرق: `settings.read` قراءةٌ للجميع، و`settings.manage`
  // كتابةٌ للمدير العام وحده. وخلطُهما يجعل كلَّ موظّفٍ يغيّر عملةَ
  // المتجر.
  { pattern: /^\/(regions|stores|store|currencies|sales-channels|tax-regions|tax-rates|shipping-profiles|shipping-options|fulfillment-sets|fulfillment-providers|return-reasons|refund-reasons|notifications|workflows-executions|plugins|feature-flags)(\/|$)/, methods: ["GET"], permission: "settings.read" },
  { pattern: /^\/(product-categories|product-collections|product-tags|product-types|price-lists)(\/|$)/, methods: ["GET"], permission: "products.read" },
  { pattern: /^\/(customers|customer-groups|claims|exchanges)(\/|$)/, methods: ["GET"], permission: "orders.read" },
  { pattern: /^\/reservations(\/|$)/, methods: ["GET"], permission: "inventory.read" },
  { pattern: /^\/(promotions|campaigns)(\/|$)/, methods: ["GET"], permission: "promotions.manage" },
  { pattern: /^\/api-keys(\/|$)/, methods: ["GET"], permission: "settings.manage" },
  // قائمةُ المستخدمين تكشف من يعمل في المتجر وأدوارَهم: تُقرأ بصلاحية
  // إدارتهم. و«من أنا» مستثناةٌ أصلاً — لا تكشف إلا صاحبَها.
  { pattern: /^\/users(\/|$)/, methods: ["GET"], permission: "users.manage" },

  // ── النظام ──────────────────────────────────────────────────────
  { pattern: /^\/users(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "users.manage" },
  { pattern: /^\/api-keys(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "settings.manage" },
  { pattern: /^\/sales-channels(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "settings.manage" },
  { pattern: /^\/store(\/|$)/, methods: ["POST", "PUT", "PATCH"], permission: "settings.manage" },
  { pattern: /^\/tax-(regions|rates)(\/|$)/, methods: ["POST", "PUT", "PATCH", "DELETE"], permission: "settings.manage" },
];

/**
 * 🔴 **ما تناديه لوحةُ Medusa لتعمل** — قائمةٌ تُفحص في كل دفعة.
 *
 * سبعُ مراحلَ مرّت وكلُّ فحوصها بـ`curl` على **مساراتنا**، فمرّت. ثم
 * فُتحت اللوحةُ في متصفّحٍ فإذا تسعةٌ وعشرون مساراً من مساراتها تُردّ
 * بـ403 — **حتى لمديرٍ عام**. فكان الحارسُ يحرس متجراً لا يُدار.
 *
 * وهذه القائمةُ تمنع تكرارَه: البوّابةُ تتأكّد أن **لكلٍّ منها قاعدةً**،
 * فلا يسقط واحدٌ في الرفض الافتراضيّ صامتاً.
 *
 * ⚠️ **وهي ليست ضماناً**: ترقيةُ Medusa قد تضيف شاشةً تنادي مساراً
 * جديداً ليس هنا. والعلامةُ حينها ظاهرةٌ لا صامتة — الشاشةُ لا تفتح —
 * ويُضاف المسارُ بنطاقه.
 */
export const ADMIN_CONSOLE_READS: string[] = [
  "/regions", "/stores", "/currencies", "/sales-channels",
  "/tax-regions", "/tax-rates",
  "/shipping-profiles", "/shipping-options", "/fulfillment-sets", "/fulfillment-providers",
  "/return-reasons", "/refund-reasons", "/notifications", "/workflows-executions", "/plugins",
  "/product-categories", "/product-collections", "/product-tags", "/product-types", "/price-lists",
  "/customers", "/customer-groups", "/claims", "/exchanges",
  "/reservations", "/promotions", "/campaigns", "/api-keys", "/users",
  "/products", "/orders", "/inventory-items", "/stock-locations", "/returns", "/payments",
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

/**
 * يقرأ `update.length` و`amount` ونحوَهما من جسم الطلب.
 *
 * ── 🔴 ولماذا يقبل النصَّ الرقميّ ────────────────────────────────
 *
 * كان الشرطُ `typeof cur === "number"` وحدَه، وفيه بابٌ مفتوح: مبالغُ
 * Medusa تعبر واجهاتِه بـ`BigNumberInput` — **وهو يقبل النصّ**. فجسمٌ
 * فيه `{"amount": "99999900"}` كان يُعيد `undefined`، ويتخطّى `can()`
 * فحصَ السقف كلَّه (`check.amount == null`)، فيمرّ استردادٌ فوق سقف
 * الدور **صامتاً**. والمبلغُ مبلغٌ سواءٌ كُتب رقماً أو نصّاً؛ والذي لا
 * يجوز أن يمرّ هو ما ليس مبلغاً أصلاً.
 *
 * والقبولُ بشرطِ الهللات الصحيحة (`ADR-008`): `^\d+$` لا كسورَ ولا
 * إشارة. ونصٌّ بكسرٍ يُردّ `undefined` — ثم يرفضه الوسيط، ولا يُقرَّب
 * صامتاً.
 */
export function readField(body: unknown, field?: string): number | undefined {
  if (!field || !body || typeof body !== "object") return undefined;
  let cur: any = body;
  for (const part of field.split(".")) {
    if (cur == null) return undefined;
    cur = part === "length" && Array.isArray(cur) ? cur.length : cur[part];
  }
  if (typeof cur === "number") return Number.isFinite(cur) ? cur : undefined;
  if (typeof cur === "string" && /^\d+$/.test(cur.trim())) return Number(cur.trim());
  return undefined;
}

/**
 * أكبرُ عددٍ يُقرأ من حقولِ القاعدة — لا أوّلُ ما وُجد.
 *
 * فدفعةٌ فيها `create` بخمسة آلاف و`update` بواحدٍ **دفعةُ خمسةِ آلاف**،
 * ومن يقيسها بذراعٍ واحدةٍ يقيس أخفَّها. و`undefined` تعني «لم يُقرأ
 * شيء» — ويقرّر الوسيطُ ماذا يفعل بها، لا هذه الدالّة.
 */
export function readCount(body: unknown, fields?: string[]): number | undefined {
  if (!fields?.length) return undefined;
  let max: number | undefined;
  for (const f of fields) {
    const v = readField(body, f);
    if (v === undefined) continue;
    max = max === undefined || v > max ? v : max;
  }
  return max;
}
