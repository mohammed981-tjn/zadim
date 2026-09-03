import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `vendor_id` في الجداول — بندٌ من جدول «**ما لا يُؤجَّل مهما ضاق
 * الوقت**» في [`07-roadmap.md`]، حجّتُه: «**إضافتُه على مليون صفٍّ هجرةٌ
 * تُوقف المتجر**».
 *
 * ── لماذا الآن، والسوقُ لن يُفتح قريباً ──────────────────────────
 *
 * لأن الكلفةَ **تُدفع مرّةً وتكبر كلَّ يوم**. `ALTER TABLE ... ADD
 * COLUMN` قابلٍ للعدم بلا قيمةٍ افتراضية عمليةٌ فوريةٌ في Postgres —
 * لا تكتب صفّاً ولا تمسّ قرصاً. **لكن القفلَ الحصريّ لازمٌ لها**: على
 * جدولٍ فارغٍ يمرّ في أجزاءٍ من الثانية، وعلى جدولٍ يبيع ينتظر خلفَ
 * كلِّ معاملةٍ مفتوحة، وينتظر خلفَه كلُّ قارئٍ — فتقف المبيعات.
 *
 * وقِيس في 2026-09-03 على القاعدة الحيّة: `vendor_id` عمودٌ **واحد**
 * في `zadim_user_role`، وهو **نطاقُ دورٍ لا ملكيّةُ صفّ**. ولا عمودَ
 * في منتجٍ ولا طلبٍ ولا مخزون.
 *
 * ── الجداولُ الأربعة، ولماذا هي بالذات ───────────────────────────
 *
 * | الجدول | لماذا يملكه بائع |
 * |---|---|
 * | `product` | البضاعةُ مِلكُ من عرضها |
 * | `order_line_item` | الطلبُ الواحد قد يحمل بضاعةَ بائعَين — **فالمِلكيّةُ على السطر لا على الطلب** |
 * | `order` | ومع ذلك يبقى على الطلب: أكثرُ الطلبات لبائعٍ واحد، والاستعلامُ عنه بلا وصلةٍ أرخصُ بمراتب |
 * | `inventory_item` | المخزونُ يُحجز ويُخصم لبائعٍ بعينه |
 *
 * ⚠️ **ولا مفتاحَ أجنبيّ إلى `zadim_vendor`.** جداولُ Medusa هذه
 * تُكتب وتُحذف بسير عملٍ لا نملكه، ومفتاحٌ أجنبيٌّ يجعل حذفَ بائعٍ
 * يسقط أو يجرّ خلفه صفوفاً — وكلاهما سلوكٌ يقرّره فتحُ السوق لا هذه
 * الهجرة. والفهرسُ الجزئيُّ يكفي للاستعلام، وسلامةُ الإشارة تُفرض
 * يومَ يصير الحقلُ مقروءاً.
 *
 * ── و«معطَّل» تعني أنه لا يُقرأ ولا يُكتب ───────────────────────
 *
 * لا مسارَ HTTP، ولا سيرَ عمل، ولا مُطلِق. متجرُ اليوم لا يتغيّر فيه
 * سطرٌ واحد. والفائدةُ كلُّها في الغد: يومَ يُفتح السوق يكون الحقلُ قد
 * رافق كلَّ صفٍّ من أوّل يوم — **بلا هجرةٍ تقف عندها المبيعات**.
 */
export class Migration20260903000020 extends Migration {
  async up(): Promise<void> {
    // ── ١) سجلُّ البائعين ───────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_vendor" (
        "id"              text not null,
        "name"            text not null,
        "handle"          text not null,
        "cr_number"       text null,
        "vat_number"      text null,
        "contact_email"   text null,
        "contact_phone"   text null,
        "commission_bps"  integer not null default 0,
        "is_active"       boolean not null default false,
        "note"            text null,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_vendor_pkey" primary key ("id"),
        -- بنقاطِ أساسٍ صحيحة (١٠٠ = ١٪). وعمولةٌ فوق المئة بالمئة ليست
        -- خصماً بل خطأَ إدخالٍ يأكل ثمنَ البضاعة.
        constraint "zadim_vendor_commission_range"
          check ("commission_bps" >= 0 and "commission_bps" <= 10000)
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_vendor_handle"
        on "zadim_vendor" ("handle") where "deleted_at" is null;
    `);

    // ── ٢) الأعمدةُ في جداول Medusa — قابلةٌ للعدم بلا افتراضيّ ──
    //
    // بلا `default`: قيمةٌ افتراضية على جدولٍ كبير تعني في إصداراتٍ
    // أقدم إعادةَ كتابته كاملاً. ونحن نضيف اليوم على الفارغ تحديداً
    // كي لا نضيف غداً على المليء — فلا نُدخل ما يُبطل الفائدة.
    for (const table of ["product", "order", "order_line_item", "inventory_item"]) {
      this.addSql(`
        alter table "${table}" add column if not exists "vendor_id" text null;
      `);
      // فهرسٌ **جزئيّ**: الأعمدةُ كلُّها `null` اليوم، وفهرسٌ كاملٌ على
      // عمودٍ فارغٍ حجمٌ يُصان بلا قارئ. والجزئيُّ ينمو مع أوّل بائع.
      this.addSql(`
        create index if not exists "IDX_${table}_vendor_id"
          on "${table}" ("vendor_id") where "vendor_id" is not null;
      `);
    }

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_vendor_cols','product','IDX_product_vendor_id',
              'vendor_id موجودٌ ومعطَّل في الجداول الأربعة — إضافتُه على جدولٍ يبيع قفلٌ توقف عنده المبيعات')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    for (const table of ["product", "order", "order_line_item", "inventory_item"]) {
      this.addSql(`drop index if exists "IDX_${table}_vendor_id";`);
      this.addSql(`alter table "${table}" drop column if exists "vendor_id";`);
    }
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_vendor_cols';`);
    this.addSql(`drop table if exists "zadim_vendor" cascade;`);
  }
}
