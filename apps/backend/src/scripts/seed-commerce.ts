import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "../modules/catalog";
import { PAYMENTS_MODULE } from "../modules/payments";
import type PaymentsModuleService from "../modules/payments/service";
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createProductsWorkflow,
  createStockLocationsWorkflow,
  createShippingProfilesWorkflow,
  createShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
  createInventoryLevelsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  createApiKeysWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * بذرةُ التجارة — **شرطُ قابلية فحص بوّابة المرحلة ٤**.
 *
 * بذرةُ الكتالوج (المرحلة ٢) أنشأت منتجاتٍ **بلا أسعارٍ ولا مخزونٍ ولا
 * قناة**: تكفي البحثَ والفلاتر ولا تُشترى. وسلّةٌ بلا سعرٍ لا تُثبت
 * شيئاً عن «تغيّرُ السعر يُرفض قبل أخذ المال» — فلا سعرَ ليتغيّر.
 *
 * فهذه تُنشئ ما يجعل الشراءَ ممكناً: منطقةٌ بعملتها، ومنطقةٌ ضريبية،
 * وقناةٌ ومستودعان مربوطان بها، وملفُّ شحنٍ وخياراه، ومنتجان لهما
 * أسعارٌ ومخزون.
 *
 * ── ولماذا عبر **سيرِ العمل** لا الوحدات مباشرةً ─────────────────
 *
 * `createProductsWorkflow` ينشئ مع المتغيّر **مادةَ مخزونٍ مرتبطةً به**
 * ويربطه بالقناة. والنداءُ المباشر لوحدة المنتجات ينشئ منتجاً لا يُحجز
 * له شيءٌ عند الطلب — وهو ما فعلته بذرةُ الكتالوج، فمنتجاتُها تُبحث
 * ولا تُشترى.
 *
 * ومُتماثلةٌ عند الإعادة: تُشغَّل مرّتين فلا تُضاعف شيئاً.
 *
 * التشغيل: npx medusa exec ./src/scripts/seed-commerce.ts
 */

/** ١٥٪ ضريبةُ القيمة المضافة — الرقمُ **بيانات** يُغيَّر من اللوحة. */
const VAT_RATE = 15;

const PRODUCTS = [
  {
    handle: "zadim-headphones",
    title: "سمّاعة زادم اللاسلكية",
    description: "سمّاعةٌ لاسلكيةٌ بعزلٍ للضجيج — منتجُ فحصٍ لمسار الشراء.",
    variants: [
      { title: "أسود", sku: "ZDM-HP-BLK", price: 39900, en: "Black" },
      { title: "أبيض", sku: "ZDM-HP-WHT", price: 39900, en: "White" },
    ],
    en: {
      title: "Zadim Wireless Headphones",
      description: "Noise-cancelling wireless headphones — a fixture for the purchase path.",
    },
  },
  {
    handle: "zadim-powerbank",
    title: "بطارية زادم المحمولة",
    description: "بطاريةٌ محمولة ١٠٠٠٠ مِلّي أمبير — منتجُ فحصٍ لمسار الشراء.",
    variants: [{ title: "قياسي", sku: "ZDM-PB-STD", price: 12900, en: "Standard" }],
    en: {
      title: "Zadim Power Bank",
      description: "A 10,000 mAh portable battery — a fixture for the purchase path.",
    },
  },
];

const LOCATIONS = [
  { name: "مستودع الرياض", city: "الرياض", priority: 10 },
  { name: "مستودع جدة", city: "جدة", priority: 5 },
];

export default async function seedCommerce({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);
  const regionModule = container.resolve(Modules.REGION);
  const storeModule = container.resolve(Modules.STORE);
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION);
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);
  const productModule = container.resolve(Modules.PRODUCT);
  const inventoryModule = container.resolve(Modules.INVENTORY);
  const taxModule = container.resolve(Modules.TAX);

  // ── ١) القناة ─────────────────────────────────────────────────
  let [channel] = await salesChannelModule.listSalesChannels({ name: "متجر زادم" });
  if (!channel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "متجر زادم", description: "القناة الأساسية" }] },
    });
    channel = result[0];
  }

  // ── ١ب) مفتاحُ النشر مربوطٌ بالقناة ───────────────────────────
  //
  // ⚠️ **بلا هذا الربط لا يعمل المتجرُ إطلاقاً**، والرسالةُ لا تشرح
  // نفسها: «Sales channel … is not associated with any stock location
  // for variant …» تظهر عند **إضافة صنفٍ للسلّة** لا عند الإعداد. وقد
  // وقعت فعلاً في الفحص الحيّ: المفتاحُ الموجود كان مربوطاً بقناةٍ
  // قديمةٍ من مرحلةٍ سابقة، فكانت كلُّ سلّةٍ تُنشأ على قناةٍ بلا مستودع.
  const apiKeyModule = container.resolve(Modules.API_KEY);
  let [pubKey] = await apiKeyModule.listApiKeys({ type: "publishable" });
  if (!pubKey) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [{ title: "متجر زادم", type: "publishable", created_by: "seed-commerce" }],
      },
    });
    pubKey = result[0];
  }
  // ومربوطٌ بقناةٍ **واحدة**: مفتاحٌ بقناتين يجعل Medusa يرفض إنشاءَ
  // أيّ سلّةٍ لا تُسمّي قناتَها صراحةً («has multiple associated sales
  // channels»)، فينكسر كلُّ زبونٍ لم يكن يُسمّيها. فتُنزع الأخرى.
  const { data: keyChannels } = await query.graph({
    entity: "api_key",
    fields: ["id", "sales_channels.id"],
    filters: { id: pubKey.id },
  });
  const linked = ((keyChannels[0] as any)?.sales_channels ?? []).map((c: any) => c.id);
  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: pubKey.id,
      add: linked.includes(channel.id) ? [] : [channel.id],
      remove: linked.filter((id: string) => id !== channel.id),
    },
  });

  // ── ٢) المنطقة والعملة ────────────────────────────────────────
  // العملةُ في المتجر أوّلاً: سعرٌ بعملةٍ لا يدعمها المتجر **لا يُحلّ**،
  // فتظهر السلّةُ بمجموعٍ صفرٍ بلا خطأ — وذاك أسوأُ من رفضٍ صريح.
  const [store] = await storeModule.listStores({});
  if (store) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          supported_currencies: [{ currency_code: "sar", is_default: true }],
          default_sales_channel_id: channel.id,
        },
      },
    });
  }

  // ── وسائلُ الدفع في المنطقة ───────────────────────────────────
  //
  // 🔴 `pp_cod_cod` **أوّلاً وهو الحقيقيّ**: الدفعُ عند الاستلام وسيلةُ
  // الدفع الوحيدةُ المبنيّةُ اليوم (`06-saudi-layer.md` §٢)، وهو ما
  // يستعمله `checkout/orchestrate.ts`. و`pp_system_default` يبقى
  // **للفحوص وحدَها** — تستعمله `probe-checkout.ts` وبعضُ البوّابات،
  // وليس وسيلةَ دفعٍ لعميل.
  const PAYMENT_PROVIDERS = ["pp_cod_cod", "pp_system_default"];

  let [region] = await regionModule.listRegions({ name: "السعودية" });
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "السعودية",
            currency_code: "sar",
            countries: ["sa"],
            payment_providers: PAYMENT_PROVIDERS,
          },
        ],
      },
    });
    region = result[0];
  }

  // ── ٢ب) سياسةُ الدفع عند الاستلام ─────────────────────────────
  //
  // 🔴 **بلا هذا الصفّ لا يبيع المتجرُ شيئاً.** غيابُ السياسة يعني
  // `COD_DISABLED` (`payments/cod.ts`: «الافتراضُ منعٌ لا سماح»)، وCOD
  // هو وسيلةُ الدفع الوحيدة — فيُرفض كلُّ إتمامٍ حتى يضبطها المالك.
  // والمنعُ الافتراضيُّ صحيحٌ في القاعدة، وبذرةٌ تُقلع متجراً لا يبيع
  // ليست بذرة.
  //
  // ⚠️ **ولا رقمَ هنا** (بند ٤٨ و«لا قاعدةَ عملٍ مبرمَجة»): الصفُّ
  // يُبذر مفعَّلاً و**كلُّ حدودِه `null`** — أي «بلا حدّ» بتعريف الوحدة
  // نفسِها، لا «الحدُّ الافتراضيّ كذا». والحدُّ الأعلى موازنةٌ بين بيعٍ
  // يُكسب وشحنتين تُخسران عند الرفض بالباب، وذاك قرارُ مالكٍ يضبطه من
  // `/admin/payments/cod-policy` — لا رقمٌ يخترعه سكربتُ بذر.
  //
  // ومُتماثلةٌ عند الإعادة: الفهرسُ `IDX_zadim_cod_policy_single` يسمح
  // بصفٍّ حيٍّ واحد، فلا تُكتب ثانيةً إن وُجدت — ولا تُداس سياسةُ متجرٍ
  // حقيقيٍّ ضبطها مالكُه.
  const payments = container.resolve(PAYMENTS_MODULE) as PaymentsModuleService;
  const [codPolicy] = await payments.listCodPolicies({}, { take: 1 });
  if (!codPolicy) {
    await payments.createCodPolicies([
      {
        is_enabled: true,
        max_order_total: null,
        min_order_total: null,
        refusals_before_block: null,
        excluded_cities: null,
        note: "بذرةٌ أوّلية — مفعَّلٌ بلا حدود. اضبط الحدودَ من لوحة الإدارة.",
      },
    ]);
    logger.info("[zadim] بُذرت سياسةُ الدفع عند الاستلام: مفعَّلةٌ بلا حدود.");
  }

  // ── ٣) المنطقة الضريبية ───────────────────────────────────────
  const taxRegions = await taxModule.listTaxRegions({ country_code: "sa" });
  if (!taxRegions.length) {
    await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: "sa",
          // ⚠️ **صراحةً**: `provider_id` فارغاً يجعل أوّلَ حسابٍ للضريبة
          // يسقط بـ«Unable to retrieve the tax provider with id: null» —
          // عند إنشاء السلّة لا عند إنشاء المنطقة، فيبدو العطلُ في مكانٍ
          // بعيدٍ عن سببه.
          provider_id: "tp_system",
          default_tax_rate: { name: "ضريبة القيمة المضافة", code: "vat", rate: VAT_RATE },
        },
      ],
    });
  } else if (!(taxRegions[0] as any).provider_id) {
    await taxModule.updateTaxRegions([{ id: taxRegions[0].id, provider_id: "tp_system" }]);
  }

  // ── ٤) المستودعات ─────────────────────────────────────────────
  const locationIds: string[] = [];
  for (const loc of LOCATIONS) {
    let [existing] = await stockLocationModule.listStockLocations({ name: loc.name });
    if (!existing) {
      const { result } = await createStockLocationsWorkflow(container).run({
        input: {
          locations: [
            {
              name: loc.name,
              address: { address_1: loc.name, city: loc.city, country_code: "sa" },
            },
          ],
        },
      });
      existing = result[0];
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: existing.id, add: [channel.id] },
      });
    }
    locationIds.push(existing.id);
  }

  // ملفّاتُ المستودع لوحدة `warehouse` — بها يعمل اختيارُ المستودع.
  const warehouse = container.resolve<any>("warehouse");
  for (let i = 0; i < LOCATIONS.length; i++) {
    const [p] = await warehouse.listLocationProfiles({ location_id: locationIds[i] });
    const fields = {
      location_id: locationIds[i],
      city: LOCATIONS[i].city,
      priority: LOCATIONS[i].priority,
      is_fulfilment_enabled: true,
      display_name_ar: LOCATIONS[i].name,
    };
    p
      ? await warehouse.updateLocationProfiles({ id: p.id, ...fields })
      : await warehouse.createLocationProfiles([fields]);
  }

  // ── ٥) الشحن: ملفٌّ ومجموعةٌ ونطاقُ خدمةٍ وخياران ─────────────
  let [profile] = await fulfillmentModule.listShippingProfiles({ name: "الملفّ الافتراضي" });
  if (!profile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "الملفّ الافتراضي", type: "default" }] },
    });
    profile = result[0];
  }

  // ⚠️ **مجموعةُ شحنٍ لكل مستودع، لا واحدةٌ للجميع.** الرابطُ بين
  // `stock_location` و`fulfillment_set` أحاديٌّ عند Medusa: ربطُ
  // مجموعةٍ واحدةٍ بمستودعين يُردّ بـ«Cannot create multiple links».
  // وهذا ليس تعسّفاً — مجموعةُ الشحن تصف **ما يخرج من هذا المستودع**،
  // فلكلٍّ نطاقُه وخياراتُه وأسعارُه.
  const SHIPPING = [
    { name: "توصيل قياسي", code: "standard", amount: 2500 },
    { name: "توصيل سريع", code: "express", amount: 4500 },
  ];

  for (let i = 0; i < LOCATIONS.length; i++) {
    const city = LOCATIONS[i].city;
    const setName = `شحن ${city}`;

    let [set] = await fulfillmentModule.listFulfillmentSets(
      { name: setName },
      { relations: ["service_zones"] }
    );

    if (!set) {
      set = await fulfillmentModule.createFulfillmentSets({
        name: setName,
        type: "shipping",
        service_zones: [
          { name: `المملكة — ${city}`, geo_zones: [{ country_code: "sa", type: "country" }] },
        ],
      });
      // بلا هذا الربط **لا يظهر أيُّ خيارِ شحنٍ للسلّة**، وتقف
      // الطلبيةُ عند خطوةٍ لا تشرح نفسها.
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: locationIds[i] },
        [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
      });
      // ومزوّدُ التنفيذ يُربط بالمستودع أيضاً — رابطٌ آخرُ بين نفس
      // الوحدتين. وبدونه يُردّ إنشاءُ خيار الشحن بـ«Providers
      // (manual_manual) are not enabled for the service location»:
      // المستودعُ يعرف ما يخرج منه، ولا يعرف **من** يخرجه.
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: locationIds[i] },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
      });
    }

    const zoneId = (set as any).service_zones[0].id;

    for (const opt of SHIPPING) {
      const optName = `${opt.name} — ${city}`;
      const [exists] = await fulfillmentModule.listShippingOptions({ name: optName });
      if (exists) continue;
      await createShippingOptionsWorkflow(container).run({
        input: [
          {
            name: optName,
            price_type: "flat",
            provider_id: "manual_manual",
            service_zone_id: zoneId,
            shipping_profile_id: profile.id,
            type: { label: opt.name, description: opt.name, code: `${opt.code}-${i}` },
            prices: [{ currency_code: "sar", amount: opt.amount }],
            rules: [
              { attribute: "enabled_in_store", value: "true", operator: "eq" },
              { attribute: "is_return", value: "false", operator: "eq" },
            ],
          },
        ],
      });
    }
  }

  // ── ٦) المنتجات بأسعارها ──────────────────────────────────────
  for (const p of PRODUCTS) {
    const [exists] = await productModule.listProducts({ handle: p.handle });
    if (exists) continue;

    await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: p.title,
            handle: p.handle,
            description: p.description,
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: profile.id,
            sales_channels: [{ id: channel.id }],
            options: [{ title: "النوع", values: p.variants.map((v) => v.title) }],
            variants: p.variants.map((v) => ({
              title: v.title,
              sku: v.sku,
              options: { "النوع": v.title },
              // ⚠️ `manage_inventory` صراحةً: بدونه لا يُحجز شيءٌ عند
              // الطلب، فيمرّ اختبارُ «نفد المخزون» **لأن المخزون لا
              // يُفحص أصلاً** — نجاحٌ لسببٍ غير الذي نظنّه.
              manage_inventory: true,
              prices: [{ currency_code: "sar", amount: v.price }],
            })),
          },
        ],
      },
    });
  }

  // ── ٦ب) ترجمةُ ما يراه الزائرُ فعلاً (المرحلة ١١ب) ─────────────
  //
  // 🔴 وهنا لا في `seed-catalog` وحدَه: منتجاتُ الكتالوج **ليست في
  // قناة البيع**، فلا تظهر في `/store/products` ولا يراها المتصفّح.
  // وبوّابةُ الواجهة تفتح الصفحةَ الحقيقية — فإن لم تُترجَم هذه
  // الاثنان بقيت `/en` عربيةً مهما امتلأ جدولُ الترجمة.
  //
  // وعناوينُهما عربيةٌ خالصة، فظهورُهما إنجليزيَّين لا يُفسَّر إلا
  // بالإلباس.
  const catalogSvc = container.resolve<any>(CATALOG_MODULE);
  let translated = 0;
  for (const p of PRODUCTS) {
    const [product] = await productModule.listProducts(
      { handle: p.handle },
      { select: ["id", "handle"] }
    );
    if (!product) continue;

    for (const [field, value] of Object.entries(p.en)) {
      await catalogSvc.setTranslation({
        entity_type: "product",
        entity_id: product.id,
        field,
        locale: "en",
        value,
      });
      translated++;
    }

    const variants = await productModule.listProductVariants(
      { product_id: product.id },
      { select: ["id", "title"] }
    );
    for (const v of variants as any[]) {
      const en = p.variants.find((x) => x.title === v.title)?.en;
      if (!en) continue;
      await catalogSvc.setTranslation({
        entity_type: "product_variant",
        entity_id: v.id,
        field: "title",
        locale: "en",
        value: en,
      });
      translated++;
    }
  }
  logger.info(`الترجمات (en): ${translated}`);

  // ── ٧) المخزون: كلُّ مادةٍ في المستودعين ──────────────────────
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
  });
  const ours = (items as any[]).filter((i) => String(i.sku ?? "").startsWith("ZDM-"));

  for (const item of ours) {
    for (const locationId of locationIds) {
      const [lvl] = await inventoryModule.listInventoryLevels({
        inventory_item_id: item.id,
        location_id: locationId,
      });
      if (lvl) continue;
      await createInventoryLevelsWorkflow(container).run({
        input: {
          inventory_levels: [
            { inventory_item_id: item.id, location_id: locationId, stocked_quantity: 100 },
          ],
        },
      });
    }
  }

  // ── ٨) كتلُ الرئيسية ──────────────────────────────────────────
  // بلا كتلٍ تكون الرئيسيةُ فارغةً — حالةٌ صحيحةٌ لكنها لا تُري أحداً
  // شيئاً. وهذه بذرةُ ترتيبٍ ابتدائيّ **يعيد المديرُ ترتيبَه من اللوحة**.
  const cms = container.resolve<any>("cms");
  const HOME_BLOCKS = [
    { type: "hero", name_ar: "الواجهة", position: 10,
      payload: { title: "زادم", subtitle: "متجرٌ سعوديّ", cta_label: "تسوّق الآن", cta_href: "/c/all" } },
    { type: "product_grid", name_ar: "الأكثر مبيعاً", position: 20,
      payload: { title: "الأكثر مبيعاً", handles: PRODUCTS.map((p) => p.handle) } },
    { type: "rich_text", name_ar: "لماذا زادم", position: 30,
      payload: { title: "لماذا زادم", body: "شحنٌ من أقرب مستودع، ودفعٌ عند الاستلام، وفاتورةٌ إلكترونية." } },
  ];
  const HOME_BLOCKS_EN: Record<string, Record<string, string>> = {
    hero: {
      "payload.title": "Zadim",
      "payload.subtitle": "A Saudi store",
      "payload.cta_label": "Shop now",
    },
    product_grid: { "payload.title": "Best sellers" },
    rich_text: {
      "payload.title": "Why Zadim",
      "payload.body":
        "Shipped from the nearest warehouse, cash on delivery, and an electronic invoice.",
    },
  };

  for (const b of HOME_BLOCKS) {
    let [block] = await cms.listPageBlocks({ page: "home", type: b.type });
    if (!block) {
      [block] = await cms.createPageBlocks([{ page: "home", is_active: true, ...b }]);
    }
    // وترجمةُ الكتل تُكتب في كل تشغيلةٍ لا عند الإنشاء وحده: قاعدةٌ
    // بُذرت قبل المرحلة ١١ب فيها الكتلُ ولا ترجمةَ لها، وشرطٌ على
    // الإنشاء يتركها عربيةً إلى الأبد.
    for (const [field, value] of Object.entries(HOME_BLOCKS_EN[b.type] ?? {})) {
      await catalogSvc.setTranslation({
        entity_type: "cms_block",
        entity_id: (block as any).id,
        field,
        locale: "en",
        value,
      });
    }
  }

  logger.info(
    `✅ بذرُ التجارة تمّ — قناةٌ ومنطقةٌ (${region.currency_code}) و${locationIds.length} مستودعاً ` +
      `و${SHIPPING.length} خيارَ شحنٍ و${ours.length} مادةَ مخزون.`
  );
}
