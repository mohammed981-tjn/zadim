import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة returns — **الحرّاسُ الأربعةُ التي لا يملكها Medusa**.
 *
 * فُحص كيانُ `return` في `@medusajs/order` قبل كتابة سطر:
 *
 *   ReturnStatus: open · requested · received · partially_received · canceled
 *   return_item:  quantity · received_quantity · damaged_quantity · reason
 *
 * وفيه ما ينفع: `location_id` و`received_at` و`created_by`. **وينقصه
 * أربعة**، وكلُّها هنا:
 *
 * ١) `location_id` **حرٌّ تماماً** — يجوز استلامُ مرتجعٍ في مستودع
 *    البيع مباشرةً، فيصير الراجعُ معروضاً لحظةَ وصوله.
 * ٢) **لا خطوةَ فحص**: يقفز من `requested` إلى `received` ومعه
 *    `damaged_quantity` رقماً بلا فاحصٍ ولا سببٍ ولا وقت.
 * ٣) **لا شيءَ يمنع** نقلَ الراجع إلى الرفّ بعدها.
 * ٤) `received_quantity` بلا سقف: يجوز استلامُ خمسٍ من مرتجعٍ طُلبت
 *    فيه ثلاث.
 *
 * ── ولماذا في القاعدة لا في الكود ────────────────────────────────
 *
 * لأن الطرقَ إلى `inventory_level` كثيرة: سيرُ عملٍ عند Medusa، وسكربتُ
 * استيراد، ومسارٌ يُكتب بعد سنة، و`psql` بيدِ مشغّل. وحارسٌ في خدمةٍ
 * يحرس من ناداها وحدَه.
 */
export class Migration20260901000090 extends Migration {
  async up(): Promise<void> {
    // ── ١) سياسةُ الإرجاع ────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_return_policy" (
        "id"                     text not null,
        "is_enabled"             boolean not null default true,
        "window_days"            integer null,
        "accepts_opened"         boolean not null default true,
        "excluded_category_ids"  jsonb null,
        "min_order_total"        integer null,
        "who_pays_shipping"      text not null default 'customer',
        "note"                   text null,
        "created_at"             timestamptz not null default now(),
        "updated_at"             timestamptz not null default now(),
        "deleted_at"             timestamptz null,
        constraint "zadim_return_policy_pkey" primary key ("id"),
        constraint "zadim_return_policy_pays_check"
          check ("who_pays_shipping" in ('store','customer')),
        -- نافذةٌ سالبةٌ أو صفرٌ ليست سياسةً بل منعاً مقنّعاً. ومن أراد
        -- المنعَ يطفئ is_enabled — فيُقرأ قصدُه من الصفّ.
        constraint "zadim_return_policy_window_check"
          check ("window_days" is null or "window_days" > 0),
        constraint "zadim_return_policy_min_check"
          check ("min_order_total" is null or "min_order_total" >= 0)
      );
    `);

    // صفٌّ حيٌّ واحد — كسياسة COD. وسياستان نافذتان تجعلان الحكمَ
    // يعتمد على أيِّهما قُرئت أوّلاً، وذاك عطلٌ لا يظهر إلا يوم يختلفان.
    this.addSql(`
      create unique index if not exists "IDX_zadim_return_policy_single"
        on "zadim_return_policy" ((true)) where "deleted_at" is null;
    `);

    // ── ٢) سجلُّ الفحص ───────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_return_inspection" (
        "id"                 text not null,
        "return_id"          text not null,
        "return_item_id"     text null,
        "inventory_item_id"  text null,
        "quantity"           integer not null,
        "outcome"            text not null,
        "reason_ar"          text not null,
        "actor_id"           text null,
        "released_quantity"  integer not null default 0,
        "created_at"         timestamptz not null default now(),
        "updated_at"         timestamptz not null default now(),
        "deleted_at"         timestamptz null,
        constraint "zadim_return_inspection_pkey" primary key ("id"),
        constraint "zadim_return_inspection_outcome_check"
          check ("outcome" in ('resellable','damaged','missing','wrong_item')),
        constraint "zadim_return_inspection_qty_check" check ("quantity" > 0),
        -- ما أُطلق لا يتجاوز ما حُكم بسلامته. ولولا هذا القيد لأمكن
        -- إطلاقُ عشرٍ بشهادةِ واحدة.
        constraint "zadim_return_inspection_released_check"
          check ("released_quantity" >= 0 and "released_quantity" <= "quantity"),
        -- **والسببُ إلزاميّ**: حكمٌ بلا سبب لا يُراجَع ولا يُتعلَّم منه.
        -- وفراغٌ بمسافةٍ ليس سبباً.
        constraint "zadim_return_inspection_reason_check"
          check (length(btrim("reason_ar")) > 0)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_return_inspection_return"
        on "zadim_return_inspection" ("return_id");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_return_inspection_outcome"
        on "zadim_return_inspection" ("outcome");
    `);

    // ── ٣) جدولُ الانتقالات ─────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_return_transition" (
        "id"           text not null,
        "from_status"  text not null,
        "to_status"    text not null,
        "reason_ar"    text not null,
        "is_active"    boolean not null default true,
        "created_at"   timestamptz not null default now(),
        "updated_at"   timestamptz not null default now(),
        "deleted_at"   timestamptz null,
        constraint "zadim_return_transition_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_return_transition_pair"
        on "zadim_return_transition" ("from_status","to_status")
        where "deleted_at" is null;
    `);

    // المصفوفةُ الشرعيّة كاملةً — من تعداد Medusa نفسِه، لا من ظنّ.
    // وما ليس هنا **ممنوع**: الجدولُ هو الآلة، لا وثيقةٌ تصفها.
    this.addSql(`
      insert into "zadim_return_transition" ("id","from_status","to_status","reason_ar")
      values
        ('rtrn_open_req','open','requested','فُتح المرتجعُ ثم طُلب رسمياً'),
        ('rtrn_open_can','open','canceled','أُلغي قبل أن يُطلب'),
        ('rtrn_req_par','requested','partially_received','وصل بعضُ الأصناف'),
        ('rtrn_req_rec','requested','received','وصلت الأصنافُ كلُّها'),
        ('rtrn_req_can','requested','canceled','ألغاه العميلُ أو الدعم قبل وصوله'),
        ('rtrn_par_rec','partially_received','received','ثم وصل الباقي'),
        ('rtrn_par_can','partially_received','canceled','أُلغي ما تبقّى')
      on conflict do nothing;
    `);

    // ── ٤) الفحصُ لا يُعدَّل ولا يُحذف ─────────────────────────────
    //
    // كدفتر الحركات وسجلّ التدقيق. وشهادةٌ يُبنى عليها استردادٌ ورجوعُ
    // بضاعةٍ إلى الرفّ ثم **تُعدَّل** ليست شهادة: من أعاد تالفاً يستطيع
    // أن يمحوَ الحكمَ ويكتب «سليم».
    //
    // ⚠️ و`released_quantity` وحدَه يجب أن يتحرّك — وإلا تعذّر تسجيلُ
    // ما أُطلق. فالقاعدةُ ليست `DO INSTEAD NOTHING` مطلقةً كالدفتر، بل
    // مُطلِقٌ يسمح بهذا العمود وحدَه ويرفض ما عداه.
    this.addSql(`
      create or replace function "zadim_guard_inspection_immutable"()
      returns trigger
      language plpgsql
      as $$
      begin
        if new."return_id"          is distinct from old."return_id"
        or new."return_item_id"     is distinct from old."return_item_id"
        or new."inventory_item_id"  is distinct from old."inventory_item_id"
        or new."quantity"           is distinct from old."quantity"
        or new."outcome"            is distinct from old."outcome"
        or new."reason_ar"          is distinct from old."reason_ar"
        or new."actor_id"           is distinct from old."actor_id"
        then
          raise exception
            'zadim: سطرُ الفحص لا يُعدَّل — والتصحيحُ سطرٌ جديدٌ يبقى الحكمان معه'
            using errcode = 'check_violation';
        end if;

        -- والإطلاقُ يزيد ولا ينقص: تنقيصُه يفتح البابَ لإطلاقٍ ثانٍ
        -- بنفس الشهادة.
        if new."released_quantity" < old."released_quantity" then
          raise exception
            'zadim: ما أُطلق لا يُنقَص — وإلا أُطلقت الكمّيةُ مرّتين بشهادةٍ واحدة'
            using errcode = 'check_violation';
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`
      drop trigger if exists "zadim_guard_inspection_immutable_trg"
        on "zadim_return_inspection";
    `);
    this.addSql(`
      create trigger "zadim_guard_inspection_immutable_trg"
        before update on "zadim_return_inspection"
        for each row execute function "zadim_guard_inspection_immutable"();
    `);

    // والحذفُ ممنوعٌ منعاً باتّاً — قاعدةٌ لا مُطلِق، كالدفتر.
    this.addSql(`
      drop rule if exists "zadim_return_inspection_no_delete"
        on "zadim_return_inspection";
    `);
    this.addSql(`
      create rule "zadim_return_inspection_no_delete" as
        on delete to "zadim_return_inspection" do instead nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop rule if exists "zadim_return_inspection_no_delete" on "zadim_return_inspection";`);
    this.addSql(`drop trigger if exists "zadim_guard_inspection_immutable_trg" on "zadim_return_inspection";`);
    this.addSql(`drop function if exists "zadim_guard_inspection_immutable"();`);
    this.addSql(`drop table if exists "zadim_return_transition" cascade;`);
    this.addSql(`drop table if exists "zadim_return_inspection" cascade;`);
    this.addSql(`drop table if exists "zadim_return_policy" cascade;`);
  }
}
