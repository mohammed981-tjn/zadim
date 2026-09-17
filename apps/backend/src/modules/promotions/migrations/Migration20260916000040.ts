import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * التخفيضُ الخاطف: جدولان ومُطلِقٌ يحرسهما.
 *
 * ── 🔴 ولماذا مُطلِقٌ لا `CHECK` ولا شرطٌ في خدمة ────────────────
 *
 * الثابتُ الذي نحرسه **يعبر صفوفاً**: مجموعُ المطالبات لهذا العرض ≤
 * سقفِه. و`CHECK` لا يرى إلا صفَّه، وشرطٌ في خدمةٍ يقرأ ثم يكتب
 * فيفسده التزاحم.
 *
 * والدرسُ مدفوعُ الثمن في هذا المستودع: `Migration20260901000002` وُلد
 * بعد أن أثبت القياسُ أن قيداً على **عدّاد** سمح بـ**٩٤ بيعاً من
 * عشرة** — لأن العدّادَ مشتقٌّ يفسده التزاحمُ فيقول «٩» والقيدُ يمرّ.
 * فلا عدّادَ هنا أصلاً: الحقيقةُ في الصفوف، و`SELECT … FOR UPDATE`
 * على صفّ العرض **يُسلسل** المتزاحمين فيقرأ الثاني مجموعاً محدَّثاً.
 *
 * ── وترتيبُ الفحوص ليس اعتباطاً ─────────────────────────────────
 *
 * الإطفاءُ ثم النافذةُ ثم السقفُ الكلّيُّ ثم حدُّ العميل. والأوّلُ هو
 * الذي يُقال للعميل، فيُقدَّم **الأعمُّ والأوضح**: «انتهى العرض» أنفعُ
 * من «بلغتَ حدَّك» لعرضٍ أُطفئ أصلاً.
 *
 * ── والسالبُ يمرّ بلا إذن ───────────────────────────────────────
 *
 * ردُّ قطعةٍ إلى العرض (صفٌّ مقابلٌ بعد إتمامٍ سقط) لا يحتاج نافذةً
 * ولا سقفاً: منعُه يعني حبسَ السعة إلى الأبد كلَّما فشل إتمام.
 */
export class Migration20260916000040 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_flash_sale" (
        "id" text not null,
        "promotion_id" text not null,
        "promotion_code" text not null,
        "starts_at" timestamptz not null,
        "ends_at" timestamptz not null,
        "quantity_limit" integer,
        "per_customer_limit" integer,
        "is_active" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz,
        constraint "zadim_flash_sale_pkey" primary key ("id"),
        -- نافذةٌ مقلوبةٌ عرضٌ لا يبدأ أبداً — ويبدو في اللوحة عرضاً قائماً.
        constraint "zadim_flash_sale_window_check" check ("ends_at" > "starts_at"),
        -- صفرٌ ليس سقفاً بل إطفاء، ويُقال بـ«is_active» لا برقمٍ يوهم.
        constraint "zadim_flash_sale_qty_check"
          check ("quantity_limit" is null or "quantity_limit" > 0),
        constraint "zadim_flash_sale_per_customer_check"
          check ("per_customer_limit" is null or "per_customer_limit" > 0)
      );
    `);

    // عرضٌ واحدٌ لا تخفيضان: وإلا تضاربَ سقفان على نفس الرمز ولا يُعرف
    // أيُّهما حَكَم.
    this.addSql(`
      create unique index if not exists "IDX_zadim_flash_sale_promotion"
        on "zadim_flash_sale" ("promotion_id")
        where "deleted_at" is null;
    `);

    this.addSql(`
      create table if not exists "zadim_flash_sale_claim" (
        "id" text not null,
        "flash_sale_id" text not null,
        "customer_key" text not null,
        "cart_id" text not null,
        "order_id" text,
        "quantity" integer not null,
        "reason" text,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        -- ⚠️ عمودٌ يطلبه ORM في كل استعلامٍ على النموذج، **وحذفٌ ناعمٌ
        -- ممنوعٌ عليه** بقاعدة المنع أدناه. وغيابُه أسقط القراءةَ كلَّها
        -- بـ«column z0.deleted_at does not exist» — قِيس على خادمٍ حيّ،
        -- ولم تمسكه بوّابةٌ لأنها تكتب بـSQL خامٍ لا بالنموذج.
        "deleted_at" timestamptz,
        constraint "zadim_flash_sale_claim_pkey" primary key ("id"),
        -- صفرٌ ليس مطالبةً ولا ردّاً — صفٌّ بلا معنى يُفسد الجمع.
        constraint "zadim_flash_sale_claim_qty_check" check ("quantity" <> 0)
      );
    `);

    this.addSql(`
      create index if not exists "IDX_zadim_flash_sale_claim_sale"
        on "zadim_flash_sale_claim" ("flash_sale_id");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_flash_sale_claim_customer"
        on "zadim_flash_sale_claim" ("flash_sale_id", "customer_key");
    `);
    // سلّةٌ واحدةٌ لا تطالب مرّتين بنفس العرض: إعادةُ إرسالِ الإتمام
    // كانت ستأكل قطعتين لطلبٍ واحد.
    this.addSql(`
      create unique index if not exists "IDX_zadim_flash_sale_claim_cart"
        on "zadim_flash_sale_claim" ("flash_sale_id", "cart_id")
        where "quantity" > 0;
    `);

    // 🔴 الدفترُ يُلحَق ولا يُمسّ — والتصحيحُ بصفٍّ مقابل.
    //
    // والمسموحُ تعديلاً **واحدٌ**: ختمُ `order_id` مرّةً بعد وقوع الطلب.
    // وما عداه يُرفض صامتاً: تغييرُ الكمّية يُزوّر السقف، والحذفُ الناعم
    // (`deleted_at`) يُحرّر سعةً بلا صفٍّ مقابل — وهو **حذفٌ بثوبٍ
    // آخر**، فيُمنع كما يُمنع الحذف.
    this.addSql(`
      create rule "zadim_flash_sale_claim_no_update" as
        on update to "zadim_flash_sale_claim"
        where old."order_id" is not null
           or new."deleted_at" is not null
           or new."quantity" <> old."quantity"
           or new."flash_sale_id" <> old."flash_sale_id"
           or new."customer_key" <> old."customer_key"
        do instead nothing;
    `);
    this.addSql(`
      create rule "zadim_flash_sale_claim_no_delete" as
        on delete to "zadim_flash_sale_claim" do instead nothing;
    `);

    this.addSql(`
      create or replace function "zadim_guard_flash_claim"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_sale record;
        v_claimed integer;
        v_mine integer;
      begin
        -- ردٌّ إلى العرض: لا نافذةَ ولا سقف. ومنعُه يحبس السعةَ أبداً.
        if new."quantity" < 0 then
          return new;
        end if;

        -- 🔴 القفلُ هنا: المتزاحمُ الثاني ينتظر فيقرأ مجموعاً محدَّثاً.
        -- وبلا هذا السطر تقرأ المئةُ نفسَ الرقم القديم — وهو بعينه ما
        -- سمح بـ٩٤ من ١٠ قبل حارس المخزون.
        select * into v_sale
          from "zadim_flash_sale"
         where "id" = new."flash_sale_id"
           and "deleted_at" is null
         for update;

        if v_sale is null then
          raise exception 'zadim: FLASH_NOT_FOUND (sale=%)', new."flash_sale_id"
            using errcode = 'check_violation';
        end if;

        if v_sale."is_active" = false then
          raise exception 'zadim: FLASH_INACTIVE (sale=%)', new."flash_sale_id"
            using errcode = 'check_violation';
        end if;

        -- النافذةُ من ساعة القاعدة لا من ساعة الزائر: مؤقّتُ المتصفّح
        -- يُضبط باليد، وصفحةٌ فُتحت قبل ساعةٍ تبقى مفتوحة.
        if now() < v_sale."starts_at" then
          raise exception 'zadim: FLASH_NOT_STARTED (sale=%)', new."flash_sale_id"
            using errcode = 'check_violation';
        end if;
        if now() >= v_sale."ends_at" then
          raise exception 'zadim: FLASH_ENDED (sale=%)', new."flash_sale_id"
            using errcode = 'check_violation';
        end if;

        if v_sale."quantity_limit" is not null then
          -- المجموعُ **الصافي**: المطالباتُ ناقصَ الردود.
          select coalesce(sum("quantity"), 0) into v_claimed
            from "zadim_flash_sale_claim"
           where "flash_sale_id" = new."flash_sale_id"
             and "id" <> new."id";

          if v_claimed + new."quantity" > v_sale."quantity_limit" then
            raise exception
              'zadim: FLASH_SOLD_OUT (sale=%, limit=%, claimed=%, want=%)',
              new."flash_sale_id", v_sale."quantity_limit", v_claimed, new."quantity"
              using errcode = 'check_violation';
          end if;
        end if;

        if v_sale."per_customer_limit" is not null then
          select coalesce(sum("quantity"), 0) into v_mine
            from "zadim_flash_sale_claim"
           where "flash_sale_id" = new."flash_sale_id"
             and "customer_key" = new."customer_key"
             and "id" <> new."id";

          if v_mine + new."quantity" > v_sale."per_customer_limit" then
            raise exception
              'zadim: FLASH_PER_CUSTOMER (sale=%, limit=%, mine=%)',
              new."flash_sale_id", v_sale."per_customer_limit", v_mine
              using errcode = 'check_violation';
          end if;
        end if;

        return new;
      end;
      $$;
    `);

    this.addSql(`
      drop trigger if exists "zadim_guard_flash_claim_trg" on "zadim_flash_sale_claim";
      create trigger "zadim_guard_flash_claim_trg"
        before insert on "zadim_flash_sale_claim"
        for each row execute function "zadim_guard_flash_claim"();
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_flash_claim_trg" on "zadim_flash_sale_claim";`);
    this.addSql(`drop function if exists "zadim_guard_flash_claim"();`);
    this.addSql(`drop rule if exists "zadim_flash_sale_claim_no_delete" on "zadim_flash_sale_claim";`);
    this.addSql(`drop rule if exists "zadim_flash_sale_claim_no_update" on "zadim_flash_sale_claim";`);
    this.addSql(`drop table if exists "zadim_flash_sale_claim";`);
    this.addSql(`drop table if exists "zadim_flash_sale";`);
  }
}
