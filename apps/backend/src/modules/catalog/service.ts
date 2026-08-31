import { MedusaService } from "@medusajs/framework/utils";
import {
  Attribute,
  CategoryAttribute,
  ProductAttributeValue,
  SearchSynonym,
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

export default CatalogModuleService;
