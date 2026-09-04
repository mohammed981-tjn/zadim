import { MedusaService } from "@medusajs/framework/utils";
import { normalizeArabic } from "../catalog/arabic";
import {
  Supplier,
  SupplierVariant,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseReceipt,
} from "./models";

/**
 * خدمةُ المشتريات (بندا ٣٢ و٣٣).
 *
 * ⚠️ **ولا تحرس ما تحرسه القاعدة.** الانتقالاتُ وتجميدُ السطور ومنعُ
 * الاستلام الزائد كلُّها مُطلِقاتٌ في `Migration20260904000020`. وفحصٌ
 * هنا يُضاعف المنطقَ ولا يزيد أماناً: من ينادي القاعدةَ مباشرةً — أو
 * سكربتُ استيرادٍ أو لوحةُ Medusa — لا يمرّ بهذه الخدمة.
 *
 * وما يقع هنا هو ما لا تستطيعه القاعدة: **الوصلُ**. الاستلامُ يزيد
 * المخزونَ ويكتب التكلفة، وكلاهما في وحداتٍ أخرى.
 */
class ProcurementModuleService extends MedusaService({
  Supplier,
  SupplierVariant,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseReceipt,
}) {
  /**
   * يُنشئ مورّداً — والاسمُ المطبَّع يُشتقّ هنا لا يُرسله المُنادي.
   *
   * فحقلٌ يحرسه فهرسٌ فريدٌ ويملؤه المُنادي يعني أن مُنادياً واحداً
   * يطبّع بطريقةٍ أخرى يفتح البابَ لمورّدَين بنفس الاسم.
   */
  async createSupplier(input: {
    name: string;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    tax_number?: string | null;
    note?: string | null;
  }) {
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("zadim: اسمُ المورّد مطلوب");
    const [row] = await this.createSuppliers([
      {
        name,
        name_normalized: normalizeArabic(name),
        contact_name: input.contact_name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        tax_number: input.tax_number ?? null,
        note: input.note ?? null,
      } as any,
    ]);
    return row;
  }

  /**
   * تسعيرةُ مورّدٍ لمتغيّر — تُنشأ أو تُحدَّث، ولا تُكرَّر (فهرسٌ فريد).
   *
   * ── و«المفضَّل» **ينتقل ولا يتضاعف** ─────────────────────────────
   *
   * الفهرسُ الجزئيُّ يضمن مفضَّلاً واحداً لكل متغيّر. وبلا نقلٍ صريحٍ هنا
   * كان تعيينُ مورّدٍ مفضَّلٍ ثانٍ **يسقط باصطدامِ فهرس** — فيصطدم مديرُ
   * المشتريات الذي يبدّل مورّدَه بجدارٍ رسالتُه «already exists»، ولا
   * يفهم أن عليه إلغاءَ تفضيل الأوّل يدوياً أوّلاً.
   *
   * وقِيس في بوّابة هذه الدفعة: أوّلُ تشغيلةٍ تمرّ والثانيةُ تسقط — أي
   * أن السلوكَ كان يعمل مرّةً واحدةً في عمر المتغيّر.
   *
   * فالتفضيلُ يُنقل: يُلغى عن الآخرين ثم يُثبَّت هنا. **والفهرسُ يبقى
   * الحارس** — النقلُ راحةُ استعمالٍ لا بديلٌ عن القيد.
   */
  async upsertSupplierVariant(input: {
    supplier_id: string;
    variant_id: string;
    unit_cost: number;
    supplier_sku?: string | null;
    lead_time_days?: number;
    is_preferred?: boolean;
  }) {
    if (!Number.isInteger(input.unit_cost) || input.unit_cost < 0) {
      throw new Error("zadim: تسعيرةُ المورّد بالهللات صحيحةً وغيرِ سالبة");
    }
    // التفضيلُ يُنقل قبل أيّ كتابة: لو أُلغي بعدها لاصطدم الفهرسُ أوّلاً.
    if (input.is_preferred) {
      const others = (await this.listSupplierVariants({
        variant_id: input.variant_id,
        is_preferred: true,
      })) as any[];
      for (const o of others) {
        if (o.supplier_id !== input.supplier_id) {
          await this.updateSupplierVariants({ id: o.id, is_preferred: false } as any);
        }
      }
    }

    const existing = await this.listSupplierVariants({
      supplier_id: input.supplier_id,
      variant_id: input.variant_id,
    });
    if (existing.length) {
      await this.updateSupplierVariants({
        id: (existing[0] as any).id,
        unit_cost: input.unit_cost,
        supplier_sku: input.supplier_sku ?? null,
        lead_time_days: input.lead_time_days ?? 0,
        is_preferred: input.is_preferred ?? false,
      } as any);
      return (await this.listSupplierVariants({ id: (existing[0] as any).id }))[0];
    }
    const [row] = await this.createSupplierVariants([
      {
        supplier_id: input.supplier_id,
        variant_id: input.variant_id,
        unit_cost: input.unit_cost,
        supplier_sku: input.supplier_sku ?? null,
        lead_time_days: input.lead_time_days ?? 0,
        is_preferred: input.is_preferred ?? false,
      } as any,
    ]);
    return row;
  }

  /** مجموعُ أمرِ شراءٍ بالهللات — يُحسب عند القراءة كأرقام اللوحة. */
  async orderTotal(purchaseOrderId: string): Promise<number> {
    const lines = (await this.listPurchaseOrderLines({
      purchase_order_id: purchaseOrderId,
    })) as any[];
    return lines.reduce(
      (sum, l) => sum + Number(l.quantity_ordered) * Number(l.unit_cost),
      0
    );
  }

  /** ما لم يصل بعدُ من كل سطر — أساسُ `incoming` وأساسُ «ماذا ينقص». */
  async outstandingLines(purchaseOrderId: string) {
    const lines = (await this.listPurchaseOrderLines({
      purchase_order_id: purchaseOrderId,
    })) as any[];
    return lines
      .map((l) => ({
        ...l,
        outstanding: Number(l.quantity_ordered) - Number(l.quantity_received),
      }))
      .filter((l) => l.outstanding > 0);
  }
}

export default ProcurementModuleService;
