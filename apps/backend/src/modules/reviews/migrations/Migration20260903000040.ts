import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * التقييمُ يشترط الشراء (بند ٢٣) — **قيدٌ في القاعدة لا فحصُ واجهة**.
 *
 * وهذا نصُّ `01-domain-model.md` حرفياً، والفرقُ بين القراءتين هو كلُّ
 * الفرق: فحصُ الواجهة يمرّ عليه من ينادي المسارَ بـcurl.
 */
export class Migration20260903000040 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_review" (
        "id"                  text not null,
        "product_id"          text not null,
        "customer_id"         text not null,
        "order_line_item_id"  text not null,
        "rating"              smallint not null,
        "body"                text null,
        "status"              text not null default 'pending',
        "moderation_note"     text null,
        "created_at"          timestamptz not null default now(),
        "updated_at"          timestamptz not null default now(),
        "deleted_at"          timestamptz null,
        constraint "zadim_review_pkey" primary key ("id"),
        constraint "zadim_review_rating_range" check ("rating" between 1 and 5),
        constraint "zadim_review_status" check ("status" in ('pending','published','rejected'))
      );
    `);

    this.addSql(`
      create unique index if not exists "IDX_zadim_review_unique"
        on "zadim_review" ("order_line_item_id", "customer_id")
        where "deleted_at" is null;
    `);
    // قراءةُ صفحة المنتج: «تقييماتُ هذا المنتج المنشورة» — وهي أكثرُ
    // قراءةٍ في الجدول، فتُفهرَس.
    this.addSql(`
      create index if not exists "IDX_zadim_review_product_status"
        on "zadim_review" ("product_id", "status")
        where "deleted_at" is null;
    `);

    // ── 🔴 حارسُ الشراء ──────────────────────────────────────────
    //
    // ثلاثةُ أسئلةٍ لا واحد، والمفتاحُ الأجنبيُّ يجيب الأوّلَ وحدَه:
    //
    // | | المفتاحُ الأجنبيّ | هذا المُطلِق |
    // |---|---|---|
    // | هل السطرُ موجود؟ | ✅ | ✅ |
    // | هل هو **لهذا العميل**؟ | ⛔ | ✅ |
    // | هل هو **لهذا المنتج**؟ | ⛔ | ✅ |
    //
    // ولولا الثاني لكتب من يعرف معرّفَ سطرِ طلبِ غيره تقييماً باسمه.
    // ولولا الثالث لقيّم من اشترى قميصاً هاتفاً لم يره.
    //
    // ⚠️ **ولا مفتاحَ أجنبيّ مع ذلك**: `order_line_item` جدولُ Medusa
    // ويُحذف منه بسير عملٍ لا نملكه، و`ON DELETE RESTRICT` يجعل تقييماً
    // **يمنع تعديلَ طلب**. فالفحصُ عند الكتابة، والصفُّ يبقى بعدها.
    this.addSql(`
      create or replace function "zadim_guard_review_purchase"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_customer text;
        v_product  text;
      begin
        select o."customer_id", li."product_id"
          into v_customer, v_product
          from "order_line_item" li
          join "order_item" oi on oi."item_id" = li."id"
          join "order" o on o."id" = oi."order_id"
         where li."id" = new."order_line_item_id"
           and li."deleted_at" is null
         limit 1;

        if v_customer is null then
          raise exception
            'zadim: لا تقييمَ بلا شراء — لا سطرَ طلبٍ بالمعرّف %', new."order_line_item_id"
            using errcode = 'check_violation';
        end if;

        if v_customer is distinct from new."customer_id" then
          raise exception
            'zadim: سطرُ الطلب ليس لهذا العميل (سطر=% )', new."order_line_item_id"
            using errcode = 'check_violation';
        end if;

        if v_product is distinct from new."product_id" then
          raise exception
            'zadim: سطرُ الطلب لمنتجٍ آخر (المشترى=% والمقيَّم=%)',
            v_product, new."product_id"
            using errcode = 'check_violation';
        end if;

        return new;
      end;
      $$;
    `);

    this.addSql(`drop trigger if exists "zadim_guard_review_purchase_trg" on "zadim_review";`);
    this.addSql(`
      create trigger "zadim_guard_review_purchase_trg"
        before insert on "zadim_review"
        for each row
        execute function "zadim_guard_review_purchase"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_review_bought','zadim_review','zadim_guard_review_purchase_trg',
              'التقييم يشترط الشراء — ويفحص المُطلِقُ الملكيّةَ والمنتجَ أيضاً، وهما ما لا يفحصه مفتاحٌ أجنبيّ')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_review_purchase_trg" on "zadim_review";`);
    this.addSql(`drop function if exists "zadim_guard_review_purchase"();`);
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_review_bought';`);
    this.addSql(`drop table if exists "zadim_review" cascade;`);
  }
}
