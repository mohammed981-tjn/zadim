import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * المفضّلة (بند ٢٢) — **قائمةُ المشتركين في انخفاض السعر**.
 *
 * والجدولُ بسيط؛ والذي يستحقّ الشرحَ قيدُه وفهرسُه.
 */
export class Migration20260903000030 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_wishlist_item" (
        "id"          text not null,
        "customer_id" text not null,
        "product_id"  text not null,
        "variant_id"  text null,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "zadim_wishlist_item_pkey" primary key ("id")
      );
    `);

    // 🔴 القيدُ الفريدُ هو الحَكَم لا فحصٌ يسبق الكتابة (ADR-014).
    //
    // ضغطتان على القلب تصلان معاً: كلتاهما تمرّان من «هل هو موجود؟»
    // فتُنشئان صفّين — ثم يصل العميلَ **خبران عن خفضٍ واحد**، وهي
    // أسرعُ طريقةٍ لجعله يوقف الإشعارات كلَّها.
    //
    // وجزئيٌّ على `deleted_at is null`: من حذف صنفاً ثم أعاده يجب أن
    // يُقبل، والصفُّ المحذوفُ ليّناً لا يمنع.
    this.addSql(`
      create unique index if not exists "IDX_zadim_wishlist_item_unique"
        on "zadim_wishlist_item" ("customer_id", "product_id")
        where "deleted_at" is null;
    `);

    // فهرسُ الاتجاه الآخر: «من ينتظر رخصَ هذا المنتج؟» يُسأل مع كلّ
    // حدثِ خفضٍ، والجوابُ بلا فهرسٍ مسحٌ كاملٌ لجدولٍ ينمو بعدد
    // العملاء × أصنافهم.
    this.addSql(`
      create index if not exists "IDX_zadim_wishlist_item_product"
        on "zadim_wishlist_item" ("product_id")
        where "deleted_at" is null;
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_wishlist','zadim_wishlist_item','IDX_zadim_wishlist_item_unique',
              'صنفٌ واحدٌ لكل عميل — وإلا وصله خبران عن خفضٍ واحد')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_wishlist';`);
    this.addSql(`drop table if exists "zadim_wishlist_item" cascade;`);
  }
}
