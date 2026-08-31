import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
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
  const categories = await productModule.listProductCategories({});
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
    },
    {
      title: "Samsung Galaxy S24",
      handle: "galaxy-s24",
      description: "جوال سامسونج جالاكسي إس ٢٤",
      category: "إلكترونيات",
      attrs: { color: "أزرق", storage: "512 جيجا", origin: "فيتنام" },
    },
    {
      title: "قميص قطن",
      handle: "cotton-shirt",
      description: "قميصٌ قطنيٌّ رجاليّ",
      category: "ملابس",
      attrs: { size: "L", color: "أبيض", material: "قطن" },
    },
  ];

  const allProducts = await productModule.listProducts({});
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
  logger.info(`المنتجات: ${DEMO_PRODUCTS.length}`);

  // ── المرادفات ──────────────────────────────────────────────────
  for (const entry of SYNONYMS) await catalog.upsertSynonym(entry);
  logger.info(`المرادفات: ${SYNONYMS.length}`);

  logger.info("✅ بذرُ الكتالوج تمّ.");
}
