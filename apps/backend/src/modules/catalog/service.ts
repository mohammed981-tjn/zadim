import { MedusaService } from "@medusajs/framework/utils";
import {
  Attribute,
  CategoryAttribute,
  ProductAttributeValue,
  SearchSynonym,
  SeoMeta,
  UrlRedirect,
} from "./models";
import { expandWithSynonyms, normalizeArabic } from "./arabic";

export type Filter = {
  attribute_code: string;
  name_ar: string;
  data_type: string;
  values: Array<{ value: string; count: number }>;
};

/**
 * خدمة الكتالوج: الخصائص والفلاتر المتولّدة ومرادفات البحث.
 *
 * وما ليس هنا عمداً: المنتجاتُ والمتغيّراتُ والتصنيفات — تلك وحدةُ
 * Medusa، ولا نكرّرها. هذه الوحدة تضيف ما لا يقدّمه: **الفلاترُ
 * المشتقّة من الخصائص**، و**تطبيعُ العربية**، و**المرادفات**.
 */
class CatalogModuleService extends MedusaService({
  Attribute,
  CategoryAttribute,
  ProductAttributeValue,
  SearchSynonym,
  SeoMeta,
  UrlRedirect,
}) {
  /**
   * فلاترُ تصنيفٍ بعينه — مولَّدةً من خصائصه وقيمها الفعلية.
   *
   * 🔴 والقيمُ تأتي **مما هو موجودٌ في المنتجات فعلاً** لا من قائمةٍ
   * معرَّفةٍ مسبقاً: فلترٌ يعرض «أحمر» ولا منتجَ أحمر يُنتج نتيجةً
   * فارغة، وهي أسوأُ من غياب الفلتر — المستخدمُ يظنّ المتجرَ معطوباً.
   */
  async getCategoryFilters(categoryId: string, productIds: string[]): Promise<Filter[]> {
    const links = await this.listCategoryAttributes(
      { category_id: categoryId },
      { relations: ["attribute"], order: { sort_order: "ASC" } }
    );

    const filters: Filter[] = [];

    for (const link of links as any[]) {
      const attribute = link.attribute;
      if (!attribute?.is_filterable) continue;

      // بلا منتجاتٍ في التصنيف لا قيمَ تُعرض — والفلترُ يسقط كلُّه.
      const values = productIds.length
        ? await this.listProductAttributeValues({
            attribute_id: attribute.id,
            product_id: productIds,
          })
        : [];

      const counts = new Map<string, number>();
      for (const v of values as any[]) {
        counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
      }

      if (!counts.size) continue;

      filters.push({
        attribute_code: attribute.code,
        name_ar: attribute.name_ar,
        data_type: attribute.data_type,
        values: [...counts.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ar")),
      });
    }

    return filters;
  }

  /**
   * كتابةُ قيمةِ خاصية — والتطبيعُ يُملأ هنا لا في المُنادي.
   *
   * فلو تُرك للمنادي لنسيَه أحدُهم يوماً، فصار صفٌّ لا يُطابقه بحثٌ
   * ولا فلتر — **وعطلٌ صامتٌ في بيانات، لا رسالةُ خطأ**.
   */
  async setProductAttribute(input: {
    product_id: string;
    attribute_id: string;
    value: string;
  }) {
    const payload = {
      ...input,
      value_normalized: normalizeArabic(input.value),
    };

    const [existing] = await this.listProductAttributeValues({
      product_id: input.product_id,
      attribute_id: input.attribute_id,
    });

    return existing
      ? await this.updateProductAttributeValues({ id: (existing as any).id, ...payload })
      : await this.createProductAttributeValues(payload);
  }

  /** إنشاءُ مرادفٍ — والتطبيعُ يُملأ هنا للسبب نفسه. */
  async upsertSynonym(input: { term: string; synonyms: string[] }) {
    const term_normalized = normalizeArabic(input.term);
    const [existing] = await this.listSearchSynonyms({ term_normalized });
    const payload = { ...input, term_normalized };

    return existing
      ? await this.updateSearchSynonyms({ id: (existing as any).id, ...payload })
      : await this.createSearchSynonyms(payload);
  }

  /**
   * بياناتُ SEO لكيان — **مع ارتدادٍ مبنيّ لا فراغ**.
   *
   * 🔴 صفحةٌ بلا `<title>` تظهر في جوجل باسم الرابط، وبلا وصفٍ يقتطع
   * جوجل سطراً عشوائياً من النصّ. فالارتدادُ ليس ترفاً: **أكثرُ
   * المنتجات لن يكتب لها أحدٌ SEO يدوياً أبداً**، والمبنيُّ آلياً من
   * الاسم والوصف أفضلُ من لا شيء بمراحل.
   */
  async getSeo(input: {
    entity: "product" | "category" | "brand" | "page";
    entity_id: string;
    locale?: string;
    fallback?: { title?: string; description?: string };
  }) {
    const locale = input.locale ?? "ar";
    const [stored] = await this.listSeoMetas({
      entity: input.entity,
      entity_id: input.entity_id,
      locale,
    });

    const title = (stored as any)?.title || input.fallback?.title || null;
    const description =
      (stored as any)?.description ||
      // الوصفُ المرتدّ يُقتطع عند ١٦٠ حرفاً — وهو ما يعرضه جوجل. وقطعُه
      // عند حدّ كلمةٍ لا وسطَها: «...جوال آيفون ١٥ بر» تبدو عطلاً.
      truncateAtWord(input.fallback?.description ?? "", 160) ||
      null;

    return {
      title,
      description,
      canonical_url: (stored as any)?.canonical_url ?? null,
      og_image: (stored as any)?.og_image ?? null,
      structured_data: (stored as any)?.structured_data ?? null,
      no_index: (stored as any)?.no_index ?? false,
      is_generated: !stored,
      locale,
    };
  }

  async setSeo(input: {
    entity: "product" | "category" | "brand" | "page";
    entity_id: string;
    locale?: string;
    title?: string | null;
    description?: string | null;
    canonical_url?: string | null;
    og_image?: string | null;
    no_index?: boolean;
  }) {
    const locale = input.locale ?? "ar";
    const [existing] = await this.listSeoMetas({
      entity: input.entity,
      entity_id: input.entity_id,
      locale,
    });
    const payload = { ...input, locale };
    return existing
      ? await this.updateSeoMetas({ id: (existing as any).id, ...payload })
      : await this.createSeoMetas(payload);
  }

  /**
   * يُنشئ تحويلاً — **ويطوي السلاسل**.
   *
   * 🔴 المشكلة التي يحلّها: تغيّر `slug` مرّتين ⇒ أ←ب ثم ب←ج. والزائرُ
   * على «أ» يقفز قفزتين، وجوجل **يُضعِف الثقة مع كل قفزة**. فالطيُّ
   * يجعلها أ←ج مباشرةً.
   *
   * ويمنع الحلقة: ج←أ بعدهما تُرفض بدل أن تُنتج دوراناً لا ينتهي.
   */
  async addRedirect(input: { from_path: string; to_path: string; status?: 301 | 302 }) {
    const from = normalizePath(input.from_path);
    let to = normalizePath(input.to_path);

    if (from === to) {
      throw new Error("[zadim] مسارٌ يحوّل إلى نفسه — حلقةٌ لا نهائية.");
    }

    // اتبع سلسلةَ الوجهة إلى نهايتها، بسقفٍ يمنع الدوران الأبديّ لو
    // تسلّلت حلقةٌ من بياناتٍ قديمة.
    const seen = new Set<string>([from, to]);
    for (let hop = 0; hop < 10; hop++) {
      const [next] = await this.listUrlRedirects({ from_path: to });
      if (!next) break;
      const target = normalizePath((next as any).to_path);
      if (seen.has(target)) {
        throw new Error(`[zadim] التحويل يُنتج حلقة: ${from} ⇒ ${target}`);
      }
      seen.add(target);
      to = target;
    }

    if (from === to) {
      throw new Error("[zadim] بعد طيّ السلسلة صار المسار يحوّل إلى نفسه.");
    }

    // وكلُّ ما كان يحوّل إلى `from` يُعاد توجيهه إلى `to` — فلا يبقى
    // زائرٌ يقفز قفزتين.
    const incoming = await this.listUrlRedirects({ to_path: from });
    for (const r of incoming as any[]) {
      if (normalizePath(r.from_path) !== to) {
        await this.updateUrlRedirects({ id: r.id, to_path: to });
      }
    }

    const [existing] = await this.listUrlRedirects({ from_path: from });
    const payload = { from_path: from, to_path: to, status: input.status ?? 301 };
    return existing
      ? await this.updateUrlRedirects({ id: (existing as any).id, ...payload })
      : await this.createUrlRedirects(payload);
  }

  /** يبحث عن تحويلٍ لمسار، ويعدّ الإصابة. */
  async resolveRedirect(path: string) {
    const [redirect] = await this.listUrlRedirects({ from_path: normalizePath(path) });
    if (!redirect) return null;
    await this.updateUrlRedirects({
      id: (redirect as any).id,
      hits: ((redirect as any).hits ?? 0) + 1,
    });
    return {
      to_path: (redirect as any).to_path,
      status: (redirect as any).status,
    };
  }

  /**
   * يوسّع استعلامَ المستخدم بمرادفاته المطبَّعة.
   *
   * ويُعيد **مصفوفةً دائماً** فيها الاستعلامُ المطبَّع على الأقل —
   * فمن ينادي هذه الدالّة لا يحتاج أن يفحص الفراغ.
   */
  async expandQuery(query: string): Promise<string[]> {
    const synonyms = await this.listSearchSynonyms({ is_active: true });
    return expandWithSynonyms(
      query,
      (synonyms as any[]).map((s) => ({
        term: s.term,
        synonyms: Array.isArray(s.synonyms) ? s.synonyms : [],
      }))
    );
  }
}

/** يقصّ عند حدّ كلمةٍ لا وسطَها — القصُّ وسطَ كلمةٍ يبدو عطلاً. */
function truncateAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** مسارٌ موحَّد: بشرطةٍ بادئة، بلا شرطةٍ لاحقة، بلا استعلام. */
function normalizePath(path: string): string {
  const p = String(path).split("?")[0].split("#")[0].trim();
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

export default CatalogModuleService;
