import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createSalesChannelsWorkflow } from "@medusajs/medusa/core-flows";
import { CATALOG_MODULE } from "../modules/catalog";
import type CatalogModuleService from "../modules/catalog/service";

/**
 * بذرةُ كتالوجٍ تجريبيّ — **شرطُ قابلية فحص البوّابة**.
 *
 * تصنيفان **مختلفا الخصائص** عمداً: إن تشابها لم يُثبت شيءٌ عن
 * «الفلاترُ تتولّد من الخصائص» — قد تكون قائمةً واحدةً مبرمَجة.
 *
 * ومنتجٌ عنوانُه لاتينيّ (`iPhone 15`) ووصفُه عربيّ: فالبوّابة تطلب أن
 * يجده من كتب «ايفون» بالعربية، وذلك **لا يعمل بالتطبيع وحده** بل
 * بالمرادف.
 *
 * ومُتماثلةٌ عند الإعادة (idempotent).
 *
 * التشغيل: npx medusa exec ./src/scripts/seed-catalog.ts
 */

const ATTRIBUTES: Array<{
  code: string;
  name_ar: string;
  name_en: string;
  data_type: "text" | "number" | "boolean" | "select";
  is_filterable?: boolean;
}> = [
  { code: "color", name_ar: "اللون", name_en: "Color", data_type: "select" },
  { code: "storage", name_ar: "السعة", name_en: "Storage", data_type: "select" },
  { code: "size", name_ar: "المقاس", name_en: "Size", data_type: "select" },
  { code: "material", name_ar: "الخامة", name_en: "Material", data_type: "select" },
  // غيرُ قابلةٍ للفلترة: تُعرض في صفحة المنتج ولا تُنتج فلتراً — وهي
  // الحالةُ التي تُثبت أن `is_filterable` يُحترم فعلاً.
  { code: "origin", name_ar: "بلد المنشأ", name_en: "Origin", data_type: "text", is_filterable: false },
];

/** أسماءُ التصنيفات بالإنجليزية — تُكتب في جدول الترجمة لا في الكيان. */
const CATEGORY_NAMES_EN: Record<string, string> = {
  "إلكترونيات": "Electronics",
  "ملابس": "Clothing",
};

/** التصنيفُ ⇒ خصائصُه. وهذا وحده ما يولّد الفلاتر. */
const CATEGORY_ATTRIBUTES: Record<string, string[]> = {
  "إلكترونيات": ["color", "storage", "origin"],
  "ملابس": ["size", "color", "material"],
};

const SYNONYMS: Array<{ term: string; synonyms: string[] }> = [
  { term: "ايفون", synonyms: ["iphone", "آيفون", "أيفون", "ابل", "apple"] },
  { term: "جوال", synonyms: ["موبايل", "هاتف", "تلفون", "phone", "mobile"] },
  { term: "لابتوب", synonyms: ["laptop", "حاسب محمول", "كمبيوتر محمول"] },
];

export default async function seedCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const catalog = container.resolve<CatalogModuleService>(CATALOG_MODULE);
  const productModule = container.resolve(Modules.PRODUCT);

  // ── الخصائص ────────────────────────────────────────────────────
  const existingAttrs = await catalog.listAttributes({});
  const attrByCode = new Map(existingAttrs.map((a: any) => [a.code, a]));

  const missing = ATTRIBUTES.filter((a) => !attrByCode.has(a.code));
  if (missing.length) {
    const created = await catalog.createAttributes(
      missing.map((a, i) => ({
        code: a.code,
        name_ar: a.name_ar,
        name_en: a.name_en,
        data_type: a.data_type,
        is_filterable: a.is_filterable ?? true,
        sort_order: i,
      }))
    );
    for (const a of [created].flat() as any[]) attrByCode.set(a.code, a);
  }
  logger.info(`الخصائص: ${attrByCode.size}`);

  // ── التصنيفات ──────────────────────────────────────────────────
  //
  // 🔴 و`select` ليس تحسيناً: بدونه **لا يُعيد `listProductCategories`
  // حقلَ `name` أصلاً**. فتصير الخريطةُ `{ undefined → آخرُ تصنيف }`،
  // ويقول الفحصُ «لا تصنيفَ بهذا الاسم» فيُنشئ من جديد — فيرتطم
  // بـ«handle already exists».
  //
  // ولم يظهر هذا في CI أبداً لأن قاعدتَه تُخلق فارغةً في كل تشغيلة:
  // لا شيءَ ليُطابَق، فالفحصُ المعطَّل يعطي الجوابَ الصحيح بالصدفة.
  // ولا يسقط إلا على قاعدةٍ باقية — أي على جهاز من يطوّر. (نفسُ صنفِ
  // العطل الذي أسقط `verify-payments` عند الإعادة.)
  const categories = await productModule.listProductCategories(
    {},
    { select: ["id", "name", "handle"] }
  );
  const catByName = new Map(categories.map((c: any) => [c.name, c]));

  for (const name of Object.keys(CATEGORY_ATTRIBUTES)) {
    if (catByName.has(name)) continue;
    const [created] = await productModule.createProductCategories([
      { name, is_active: true },
    ]);
    catByName.set(name, created);
  }

  // ── ربطُ الخصائص بالتصنيفات ────────────────────────────────────
  for (const [catName, codes] of Object.entries(CATEGORY_ATTRIBUTES)) {
    const category = catByName.get(catName) as any;
    const existing = await catalog.listCategoryAttributes({ category_id: category.id });
    const linked = new Set((existing as any[]).map((l) => l.attribute_id));

    for (const [i, code] of codes.entries()) {
      const attr = attrByCode.get(code) as any;
      // خاصيةٌ مذكورةٌ في تصنيفٍ ولا وجودَ لها عطلُ إعدادٍ لا حالةٌ
      // تُتجاوز: التصنيفُ سيفقد فلتراً ولا أحد يعرف لماذا.
      if (!attr) throw new Error(`[zadim] الخاصية «${code}» غير معرّفة للتصنيف «${catName}»`);
      if (linked.has(attr.id)) continue;
      await catalog.createCategoryAttributes({
        category_id: category.id,
        attribute_id: attr.id,
        sort_order: i,
      });
    }
  }
  logger.info(`التصنيفات: ${[...catByName.keys()].join(" · ")}`);

  // ── منتجاتٌ تجريبية ────────────────────────────────────────────
  const DEMO_PRODUCTS = [
    {
      title: "iPhone 15 Pro",
      handle: "iphone-15-pro",
      description: "جوال آيفون ١٥ برو بشاشة سوبر ريتينا",
      category: "إلكترونيات",
      attrs: { color: "أسود", storage: "256 جيجا", origin: "الصين" },
      en: { description: "iPhone 15 Pro with a Super Retina display" },
    },
    {
      title: "Samsung Galaxy S24",
      handle: "galaxy-s24",
      description: "جوال سامسونج جالاكسي إس ٢٤",
      category: "إلكترونيات",
      attrs: { color: "أزرق", storage: "512 جيجا", origin: "فيتنام" },
      en: { description: "Samsung Galaxy S24 smartphone" },
    },
    {
      // 🔴 **المنتجُ الذي تُقاس عليه البوّابة**: عنوانُه عربيٌّ خالص،
      // فظهورُه إنجليزياً في `/en` لا يُفسَّر إلا بترجمةٍ من القاعدة.
      title: "قميص قطن",
      handle: "cotton-shirt",
      description: "قميصٌ قطنيٌّ رجاليّ",
      category: "ملابس",
      attrs: { size: "L", color: "أبيض", material: "قطن" },
      en: { title: "Cotton Shirt", description: "A men's cotton shirt" },
    },
  ] as Array<{
    title: string;
    handle: string;
    description: string;
    category: string;
    attrs: Record<string, string>;
    en?: Record<string, string>;
  }>;

  // و`select` هنا لنفس السبب أعلاه: الخريطةُ مبنيّةٌ على `handle`.
  const allProducts = await productModule.listProducts({}, { select: ["id", "handle"] });
  const prodByHandle = new Map(allProducts.map((p: any) => [p.handle, p]));

  for (const demo of DEMO_PRODUCTS) {
    let product = prodByHandle.get(demo.handle) as any;
    if (!product) {
      const category = catByName.get(demo.category) as any;
      const [created] = await productModule.createProducts([
        {
          title: demo.title,
          handle: demo.handle,
          description: demo.description,
          status: "published",
          category_ids: [category.id],
          options: [{ title: "افتراضي", values: ["واحد"] }],
          variants: [
            { title: demo.title, sku: demo.handle.toUpperCase(), options: { "افتراضي": "واحد" } },
          ],
        },
      ]);
      product = created;
      prodByHandle.set(demo.handle, product);
    }

    for (const [code, value] of Object.entries(demo.attrs)) {
      const attr = attrByCode.get(code) as any;
      await catalog.setProductAttribute({
        product_id: product.id,
        attribute_id: attr.id,
        value,
      });
    }
  }

  // ── 🔴 ربطُ المنتجات بقناة البيع ──────────────────────────────
  //
  // ── العطبُ الذي أُصلح هنا ──────────────────────────────────────
  //
  // هذه البذرةُ تُنشئ منتجاتِها بـ`productModule.createProducts`
  // مباشرةً، لا بسير عمل Medusa كما تفعل `seed-commerce`. والفرقُ أن
  // النداءَ المباشر **لا يربطها بقناة بيع**.
  //
  // و`‎/store/products` يصفّي بقناةِ مفتاح النشر. فمنتجاتٌ بلا قناةٍ
  // **موجودةٌ ومنشورةٌ ولا يراها زائرٌ أبداً**: قِيس أن
  // `‎?category_id[]=…` يُعيد صفراً، **فكلُّ صفحة تصنيفٍ في المتجر
  // فارغة** وتقول «لا منتجات في هذا القسم» — وهي كذبة.
  //
  // ولم تمسكه بوّابةٌ لأن بوّابةَ الكتالوج تنادي الوحدةَ مباشرةً
  // (فتراها)، وبوّابةَ المتجر تفحص منتجاتِ `seed-commerce` وحدَها
  // (وهي مربوطة). فالفجوةُ كانت بين الاثنتين بالضبط.
  //
  // والقناةُ تُسمّى كما تسمّيها `seed-commerce` كي تلتقيا على واحدةٍ
  // لا اثنتين — والبذرتان تعملان بأيّ ترتيب.
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL);
  let [channel] = await salesChannelModule.listSalesChannels({ name: "متجر زادم" });
  if (!channel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "متجر زادم", description: "القناة الأساسية" }] },
    });
    channel = (result as any)[0];
  }

  const link = container.resolve(ContainerRegistrationKeys.LINK);
  let linked = 0;
  for (const demo of DEMO_PRODUCTS) {
    const product = prodByHandle.get(demo.handle) as any;
    if (!product) continue;
    try {
      await link.create({
        [Modules.PRODUCT]: { product_id: product.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: (channel as any).id },
      });
      linked++;
    } catch {
      // الوصلةُ قائمةٌ من تشغيلةٍ سابقة — والبذرةُ متماثلةٌ عند
      // الإعادة، فالتكرارُ ليس خطأً.
    }
  }

  logger.info(`المنتجات: ${DEMO_PRODUCTS.length} (وُصل ${linked} بقناة البيع)`);

  // ── المرادفات ──────────────────────────────────────────────────
  for (const entry of SYNONYMS) await catalog.upsertSynonym(entry);
  logger.info(`المرادفات: ${SYNONYMS.length}`);

  // ── الترجمة الإنجليزية (المرحلة ١١ب) ────────────────────────────
  //
  // 🔴 وليست زينةً في البذرة بل **شرطُ قابليةِ فحص البوّابة**، تماماً
  // كما أن تصنيفَين مختلفَي الخصائص شرطُ فحص الفلاتر.
  //
  // فالبوّابة تسأل: هل `/en` متجرٌ إنجليزيّ أم واجهةٌ إنجليزيةٌ فوق
  // محتوىً عربيّ؟ وهذا سؤالٌ **لا يُجاب بمنتجٍ عنوانُه `iPhone 15
  // Pro`** — عنوانُه لاتينيٌّ في اللغتين، فيمرّ الفحصُ بلا أن يُثبت
  // شيئاً. و«قميص قطن» وحدَه يفصل: إن ظهر عربياً في `/en` فالإلباسُ
  // معطَّل، ولا سبيلَ إلى تفسيرٍ آخر.
  //
  // وما لا ترجمةَ له هنا مقصودٌ أيضاً: `subtitle` لا يُترجَم لأحدٍ،
  // فيثبت أن الغائبَ يعود بأصله لا فارغاً.
  let translated = 0;
  for (const demo of DEMO_PRODUCTS) {
    const product = prodByHandle.get(demo.handle) as any;
    if (!product || !demo.en) continue;
    for (const [field, value] of Object.entries(demo.en)) {
      await catalog.setTranslation({
        entity_type: "product",
        entity_id: product.id,
        field,
        locale: "en",
        value,
      });
      translated++;
    }
  }
  for (const [name_ar, name_en] of Object.entries(CATEGORY_NAMES_EN)) {
    const category = catByName.get(name_ar) as any;
    if (!category) continue;
    await catalog.setTranslation({
      entity_type: "product_category",
      entity_id: category.id,
      field: "name",
      locale: "en",
      value: name_en,
    });
    translated++;
  }
  logger.info(`الترجمات (en): ${translated}`);

  logger.info("✅ بذرُ الكتالوج تمّ.");
}
