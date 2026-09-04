import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * طبقةُ الكوبونات فوق محرّك Medusa (بندا ٢٦ و٢٧).
 *
 * ولا يُبنى هنا شيءٌ يملكه المحرّك: الرمزُ وتفرّدُه · فصلُ العرض عن
 * الكوبون · القواعدُ صفوفاً · الحملاتُ ونوافذُها · الحدُّ الكلّيُّ بقفلِ
 * صفّ. يُبنى ما لا يملكه: **الحدُّ لكل عميل · سقفُ الخصم بالمال ·
 * أوّلُ طلبٍ فقط · وترتيبُ التطبيق رقماً يضبطه المدير**.
 */
export class Migration20260904000030 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_coupon_policy" (
        "id"                  text not null,
        "promotion_id"        text not null,
        "promotion_code"      text not null,
        "per_customer_limit"  integer null,
        "max_discount"        integer null,
        "first_order_only"    boolean not null default false,
        "priority"            integer not null default 100,
        "created_at"          timestamptz not null default now(),
        "updated_at"          timestamptz not null default now(),
        "deleted_at"          timestamptz null,
        constraint "zadim_coupon_policy_pkey" primary key ("id"),
        constraint "zadim_coupon_policy_limit_positive"
          check ("per_customer_limit" is null or "per_customer_limit" >= 1),
        constraint "zadim_coupon_policy_cap_positive"
          check ("max_discount" is null or "max_discount" >= 1)
      );
    `);
    // `>= 1` لا `>= 0` في الحقلين: صفرٌ في الحدّ يعني «ممنوعٌ على
    // الجميع»، وصفرٌ في السقف يعني «خصمٌ لا شيء» — وكلاهما إطفاءٌ يُقال
    // بـ`status` في Medusa، لا برقمٍ يبدو حدّاً وهو إطفاء. وحقلٌ يقول
    // شيئاً ويفعل آخر أسوأُ من غيابه.
    this.addSql(`
      create unique index if not exists "IDX_zadim_coupon_policy_promotion"
        on "zadim_coupon_policy" ("promotion_id")
        where "deleted_at" is null;
    `);

    this.addSql(`
      create table if not exists "zadim_coupon_redemption" (
        "id"              text not null,
        "promotion_id"    text not null,
        "promotion_code"  text not null,
        "customer_id"     text not null,
        "cart_id"         text null,
        "order_id"        text null,
        "redemption_seq"  integer not null,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_coupon_redemption_pkey" primary key ("id"),
        constraint "zadim_coupon_redemption_seq_positive" check ("redemption_seq" >= 1)
      );
    `);

    // ── 🔴 القيدُ الذي يمنع السباق ────────────────────────────────
    //
    // فهرسٌ فريدٌ على (العرض، العميل، ترتيبُ الاستهلاك). ومحاولتان
    // متزامنتان تقرآن «استهلك صفراً» فتحسبان الترتيبَ ١ ⇒ إحداهما
    // تصطدم. وهو ADR-014 نفسُه: **التفرّدُ بقيدٍ لا بفحصٍ قبل الكتابة**
    // — لأن «اقرأِ العدَّ ثم قرّر» صحيحٌ في كل تشغيلةٍ منفردة وخاطئٌ في
    // اثنتين معاً. وهو نصُّ `01-domain-model.md` §٣: «وإلا مرّ ألفُ
    // طلبٍ في ثانيةٍ واحدة على كوبونٍ حدُّه واحد».
    //
    // ⚠️ ولا شرطَ `deleted_at is null` هنا **عمداً**، بخلاف بقيّة
    // فهارسنا: حذفٌ ناعمٌ لصفِّ استهلاكٍ يُعيد للعميل حقَّ استعمالٍ
    // استعمله. والدفترُ الماليُّ لا يُنسى بحذفٍ ناعم.
    this.addSql(`
      create unique index if not exists "IDX_zadim_coupon_redemption_seq"
        on "zadim_coupon_redemption" ("promotion_id", "customer_id", "redemption_seq");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_coupon_redemption_customer"
        on "zadim_coupon_redemption" ("customer_id", "promotion_id");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_coupon_redemption_order"
        on "zadim_coupon_redemption" ("order_id")
        where "order_id" is not null;
    `);

    // ── الحارس: يملأ الترتيبَ ويرفض تجاوزَ الحدّ ─────────────────
    //
    // ولماذا مُطلِقٌ قبليٌّ يحسب الترتيبَ بنفسه بدل أن يرسله المسار:
    // لأن المسارَ الذي يحسبه يقرأ العدَّ أوّلاً، وبين قراءته وكتابته تقع
    // الكتابةُ الأخرى. وحسابُه هنا يجعل الفهرسَ فوقه حارساً كافياً:
    // أسوأُ ما يقع اصطدامٌ يُقرأ ويُترجَم، لا استهلاكٌ زائدٌ يُكتشف في
    // تقرير آخر الشهر.
    this.addSql(`
      create or replace function "zadim_guard_coupon_redemption"()
      returns trigger language plpgsql as $$
      declare
        v_limit integer;
        v_used  integer;
      begin
        if new."customer_id" is null or btrim(new."customer_id") = '' then
          raise exception 'zadim: لا استهلاكَ كوبونٍ بلا عميل';
        end if;

        select "per_customer_limit" into v_limit
          from "zadim_coupon_policy"
         where "promotion_id" = new."promotion_id" and "deleted_at" is null
         limit 1;

        select count(*) into v_used
          from "zadim_coupon_redemption"
         where "promotion_id" = new."promotion_id"
           and "customer_id"  = new."customer_id";

        if v_limit is not null and v_used >= v_limit then
          raise exception 'zadim: تجاوزُ حدِّ الكوبون لكل عميل (%)', v_limit;
        end if;

        new."redemption_seq" := v_used + 1;
        return new;
      end $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_coupon_redemption_trg" on "zadim_coupon_redemption";`);
    this.addSql(`
      create trigger "zadim_guard_coupon_redemption_trg"
        before insert on "zadim_coupon_redemption"
        for each row execute function "zadim_guard_coupon_redemption"();
    `);

    // ── ودفترُ الاستهلاك لا يُمسّ ───────────────────────────────
    //
    // صفٌّ يقول «استعمل هذا العميلُ هذا الكوبون» يُعدَّل ⇒ يستطيع من
    // يملك التعديلَ أن يمنح استعمالاً ثانياً بلا أثر. فالتعديلُ يُرفض،
    // والتصحيحُ بصفٍّ جديد.
    //
    // ⚠️ ما عدا `order_id`: الاستهلاك يُسجَّل عند الإتمام وقد لا يكون
    // معرّفُ الطلب معروفاً بعد. فيُملأ **مرّةً من `null`** ولا يُغيَّر
    // بعدها — نفسُ نمط `unit_cost` المجمَّدة.
    this.addSql(`
      create or replace function "zadim_freeze_coupon_redemption"()
      returns trigger language plpgsql as $$
      begin
        if new."promotion_id"   is distinct from old."promotion_id"
        or new."customer_id"    is distinct from old."customer_id"
        or new."redemption_seq" is distinct from old."redemption_seq"
        or new."promotion_code" is distinct from old."promotion_code" then
          raise exception 'zadim: دفترُ استهلاك الكوبون لا يُعدَّل';
        end if;
        if old."order_id" is not null and new."order_id" is distinct from old."order_id" then
          raise exception 'zadim: معرّفُ الطلب في دفتر الاستهلاك يُكتب مرّةً واحدة';
        end if;
        return new;
      end $$;
    `);
    this.addSql(`drop trigger if exists "zadim_freeze_coupon_redemption_trg" on "zadim_coupon_redemption";`);
    this.addSql(`
      create trigger "zadim_freeze_coupon_redemption_trg"
        before update on "zadim_coupon_redemption"
        for each row execute function "zadim_freeze_coupon_redemption"();
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_freeze_coupon_redemption_trg" on "zadim_coupon_redemption";`);
    this.addSql(`drop trigger if exists "zadim_guard_coupon_redemption_trg" on "zadim_coupon_redemption";`);
    this.addSql(`drop function if exists "zadim_freeze_coupon_redemption"();`);
    this.addSql(`drop function if exists "zadim_guard_coupon_redemption"();`);
    this.addSql(`drop table if exists "zadim_coupon_redemption" cascade;`);
    this.addSql(`drop table if exists "zadim_coupon_policy" cascade;`);
  }
}
