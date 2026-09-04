import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * الموردون وأوامرُ الشراء (بندا ٣٢ و٣٣).
 *
 * ── ما يحرسه هذا الملفّ، ولماذا في القاعدة لا في الكود ───────────
 *
 * أمرُ الشراء **يزيد المخزون**. وكلُّ ما يزيد المخزونَ أو ينقصه في هذا
 * المشروع محروسٌ بقيدٍ لا بشرطِ `if`: الشرطُ يقرأ ثم يكتب، وبين
 * القراءة والكتابة يمرّ المستلمُ الثاني. وهي القاعدةُ نفسُها التي
 * تمنع `-1` في المخزون (`01-domain-model.md` §٢).
 *
 * فالحرّاسُ خمسة:
 *
 * ١. **انتقالاتُ الحالة** — مصفوفةٌ في مُطلِق، لا `switch` في خدمة.
 * ٢. **السطورُ تُجمَّد عند الإرسال** — «طلبنا عشراً بعشرين» لا تصير
 *    «مئةً باثنين» بتعديلٍ بعد الاستلام.
 * ٣. **لا استلامَ يتجاوز المطلوب** — والفحصُ عند الكتابة داخل نفس
 *    المعاملة، لا قراءةٌ سابقةٌ لها.
 * ٤. **دفترُ الإيصالات يُلحَق ولا يُمسّ** — والتصحيحُ بإيصالٍ سالبٍ
 *    مقابل، فيبقى أثرُ الخطأ ومن ارتكبه.
 * ٥. **لا إلغاءَ لأمرٍ استُلم منه شيء** — بضاعةٌ على الرفّ لا يمحوها
 *    تغييرُ حالةِ ورقة.
 */
export class Migration20260904000020 extends Migration {
  async up(): Promise<void> {
    // ── ٣٢) الموردون ────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_supplier" (
        "id"               text not null,
        "name"             text not null,
        "name_normalized"  text not null,
        "contact_name"     text null,
        "phone"            text null,
        "email"            text null,
        "tax_number"       text null,
        "active"           boolean not null default true,
        "note"             text null,
        "created_at"       timestamptz not null default now(),
        "updated_at"       timestamptz not null default now(),
        "deleted_at"       timestamptz null,
        constraint "zadim_supplier_pkey" primary key ("id"),
        constraint "zadim_supplier_name_not_blank" check (btrim("name") <> '')
      );
    `);
    // مورّدان بنفس الاسم خطأُ إدخالٍ لا حالةٌ واقعية — والتفرّدُ على
    // **المطبَّع** لا على الخام: «مؤسسة النور» و«مؤسسه النور» مورّدٌ واحد.
    this.addSql(`
      create unique index if not exists "IDX_zadim_supplier_name"
        on "zadim_supplier" ("name_normalized")
        where "deleted_at" is null;
    `);

    this.addSql(`
      create table if not exists "zadim_supplier_variant" (
        "id"              text not null,
        "supplier_id"     text not null,
        "variant_id"      text not null,
        "supplier_sku"    text null,
        "unit_cost"       integer not null,
        "lead_time_days"  integer not null default 0,
        "is_preferred"    boolean not null default false,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_supplier_variant_pkey" primary key ("id"),
        constraint "zadim_supplier_variant_cost_positive" check ("unit_cost" >= 0),
        constraint "zadim_supplier_variant_lead_positive" check ("lead_time_days" >= 0),
        constraint "zadim_supplier_variant_supplier_fk"
          foreign key ("supplier_id") references "zadim_supplier" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_supplier_variant_pair"
        on "zadim_supplier_variant" ("supplier_id", "variant_id")
        where "deleted_at" is null;
    `);
    // 🔴 مورّدٌ **مفضَّلٌ واحدٌ** لكل متغيّر — فهرسٌ جزئيٌّ لا شرطٌ في
    // الكود. ولولاه لصار «المفضَّل» حقلاً يقول شيئاً ويعني اثنين.
    this.addSql(`
      create unique index if not exists "IDX_zadim_supplier_variant_preferred"
        on "zadim_supplier_variant" ("variant_id")
        where "is_preferred" and "deleted_at" is null;
    `);

    // ── ٣٣) أوامرُ الشراء ───────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_purchase_order" (
        "id"                text not null,
        "supplier_id"       text not null,
        "location_id"       text not null,
        "status"            text not null default 'draft',
        "currency_code"     text not null default 'sar',
        "placed_at"         timestamptz null,
        "expected_at"       timestamptz null,
        "received_at"       timestamptz null,
        "cancelled_at"      timestamptz null,
        "created_by"        text null,
        "created_by_label"  text null,
        "note"              text null,
        "created_at"        timestamptz not null default now(),
        "updated_at"        timestamptz not null default now(),
        "deleted_at"        timestamptz null,
        constraint "zadim_purchase_order_pkey" primary key ("id"),
        constraint "zadim_purchase_order_status" check ("status" in
          ('draft','placed','partially_received','received','cancelled')),
        constraint "zadim_purchase_order_supplier_fk"
          foreign key ("supplier_id") references "zadim_supplier" ("id") on delete restrict
      );
    `);
    // ⚠️ و`on delete restrict` هنا **عمداً** بخلاف `cascade` أعلاه:
    // تسعيرةُ مورّدٍ تذهب معه، وأمرُ شراءٍ **دفترٌ ماليّ** لا يُمحى بحذف
    // صفٍّ آخر. فالمورّدُ ذو الأوامر يُوقَف ولا يُحذف.
    this.addSql(`
      create index if not exists "IDX_zadim_purchase_order_supplier"
        on "zadim_purchase_order" ("supplier_id", "status");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_purchase_order_open"
        on "zadim_purchase_order" ("status", "created_at")
        where "status" in ('placed','partially_received');
    `);

    this.addSql(`
      create table if not exists "zadim_purchase_order_line" (
        "id"                 text not null,
        "purchase_order_id"  text not null,
        "variant_id"         text not null,
        "inventory_item_id"  text not null,
        "quantity_ordered"   integer not null,
        "quantity_received"  integer not null default 0,
        "unit_cost"          integer not null,
        "created_at"         timestamptz not null default now(),
        "updated_at"         timestamptz not null default now(),
        "deleted_at"         timestamptz null,
        constraint "zadim_purchase_order_line_pkey" primary key ("id"),
        constraint "zadim_po_line_qty_positive" check ("quantity_ordered" > 0),
        constraint "zadim_po_line_cost_positive" check ("unit_cost" >= 0),
        -- 🔴 الحارسُ الأهمّ: لا استلامَ يتجاوز المطلوب، ولا استلامَ سالبَ
        -- المحصّلة. وهو قيدٌ لا شرطٌ في خدمة — لأن مستلمَين متزامنَين
        -- يقرآن «وصل ٥ من ١٠» فيكتب كلٌّ منهما ٦.
        constraint "zadim_po_line_received_range"
          check ("quantity_received" >= 0 and "quantity_received" <= "quantity_ordered"),
        constraint "zadim_po_line_order_fk"
          foreign key ("purchase_order_id") references "zadim_purchase_order" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_po_line_order"
        on "zadim_purchase_order_line" ("purchase_order_id");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_po_line_variant"
        on "zadim_purchase_order_line" ("variant_id");
    `);

    this.addSql(`
      create table if not exists "zadim_purchase_receipt" (
        "id"                       text not null,
        "purchase_order_id"        text not null,
        "purchase_order_line_id"   text not null,
        "quantity"                 integer not null,
        "received_by"              text null,
        "received_by_label"        text null,
        "note"                     text null,
        "created_at"               timestamptz not null default now(),
        "updated_at"               timestamptz not null default now(),
        "deleted_at"               timestamptz null,
        constraint "zadim_purchase_receipt_pkey" primary key ("id"),
        -- إيصالٌ بصفرٍ ليس إيصالاً — كحركةِ مخزونٍ بفرقِ صفر.
        constraint "zadim_purchase_receipt_qty_nonzero" check ("quantity" <> 0),
        constraint "zadim_purchase_receipt_line_fk"
          foreign key ("purchase_order_line_id")
          references "zadim_purchase_order_line" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_purchase_receipt_order"
        on "zadim_purchase_receipt" ("purchase_order_id", "created_at");
    `);

    // ── الدفترُ يُلحَق ولا يُمسّ — كدفتر حركات المخزون ────────────
    //
    // `DO INSTEAD NOTHING` لا `raise`، للسبب نفسِه المكتوب هناك:
    // الرفعُ يُسقط معاملةَ من حاول وقد يكون مساراً لا نتحكّم فيه،
    // والمطلوبُ ألّا يتغيّر السطرُ لا أن يتوقّف المستودع.
    this.addSql(`create or replace rule "zadim_purchase_receipt_no_update" as
                 on update to "zadim_purchase_receipt" do instead nothing;`);
    this.addSql(`create or replace rule "zadim_purchase_receipt_no_delete" as
                 on delete to "zadim_purchase_receipt" do instead nothing;`);

    // ── حارسُ انتقالات الحالة ────────────────────────────────────
    this.addSql(`
      create or replace function "zadim_guard_po_transition"()
      returns trigger language plpgsql as $$
      declare
        v_received integer;
      begin
        if new."status" = old."status" then
          return new;
        end if;

        -- المصفوفةُ كاملةً، ولا «وإلا فاسمح».
        if not (
             (old."status" = 'draft'              and new."status" in ('placed','cancelled'))
          or (old."status" = 'placed'             and new."status" in ('partially_received','received','cancelled'))
          or (old."status" = 'partially_received' and new."status" in ('received','cancelled'))
        ) then
          raise exception 'zadim: انتقالٌ ممنوع لأمر الشراء: % ⇐ %', old."status", new."status";
        end if;

        -- 🔴 لا إلغاءَ لأمرٍ استُلم منه شيء.
        --
        -- بضاعةٌ صارت على الرفّ لا يمحوها تغييرُ حالةِ ورقة. ولو سُمح
        -- به لصار «ألغِ الأمر» طريقاً لإدخال بضاعةٍ بلا أثرٍ ماليّ.
        if new."status" = 'cancelled' then
          select coalesce(sum("quantity_received"), 0) into v_received
            from "zadim_purchase_order_line"
           where "purchase_order_id" = new."id" and "deleted_at" is null;
          if v_received > 0 then
            raise exception 'zadim: لا يُلغى أمرُ شراءٍ استُلم منه % وحدة', v_received;
          end if;
        end if;

        return new;
      end $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_po_transition_trg" on "zadim_purchase_order";`);
    this.addSql(`
      create trigger "zadim_guard_po_transition_trg"
        before update on "zadim_purchase_order"
        for each row execute function "zadim_guard_po_transition"();
    `);

    // ── حارسُ تجميد السطور بعد الإرسال ──────────────────────────
    this.addSql(`
      create or replace function "zadim_freeze_po_line"()
      returns trigger language plpgsql as $$
      declare
        v_status text;
      begin
        select "status" into v_status from "zadim_purchase_order"
         where "id" = coalesce(new."purchase_order_id", old."purchase_order_id");

        if v_status is null or v_status = 'draft' then
          return coalesce(new, old);
        end if;

        if tg_op = 'DELETE' then
          raise exception 'zadim: لا يُحذف سطرٌ من أمرِ شراءٍ أُرسل';
        end if;

        -- بعد الإرسال: \`quantity_received\` وحدَها تتغيّر، ويكتبها مُطلِقُ
        -- الإيصالات لا يدُ أحد.
        if new."quantity_ordered" is distinct from old."quantity_ordered"
        or new."unit_cost"        is distinct from old."unit_cost"
        or new."variant_id"       is distinct from old."variant_id"
        or new."inventory_item_id" is distinct from old."inventory_item_id" then
          raise exception 'zadim: سطرُ أمر شراءٍ أُرسل لا يُعدَّل — يُلغى الأمرُ ويُعاد';
        end if;

        return new;
      end $$;
    `);
    this.addSql(`drop trigger if exists "zadim_freeze_po_line_trg" on "zadim_purchase_order_line";`);
    this.addSql(`
      create trigger "zadim_freeze_po_line_trg"
        before update or delete on "zadim_purchase_order_line"
        for each row execute function "zadim_freeze_po_line"();
    `);

    // ── مُطلِقُ الإيصال: يزيد العدّادَ ويُقفل الأمرَ حين يكتمل ────
    //
    // 🔴 **العدّادُ يُكتب هنا لا في الخدمة.** الخدمةُ تكتب إيصالاً،
    // والقاعدةُ تُحدّث العدّاد داخل نفس المعاملة. فمستلمان متزامنان
    // يكتبان إيصالَين، والقيدُ `received <= ordered` يُسقط الثاني إن
    // تجاوز — وهو نفسُ منطق `CHECK (reserved <= on_hand)` في المخزون.
    this.addSql(`
      create or replace function "zadim_apply_purchase_receipt"()
      returns trigger language plpgsql as $$
      declare
        v_po_status text;
        v_open      integer;
      begin
        select "status" into v_po_status from "zadim_purchase_order"
         where "id" = new."purchase_order_id" for update;

        if v_po_status is null then
          raise exception 'zadim: إيصالٌ لأمرِ شراءٍ غيرِ موجود';
        end if;
        -- الاستلامُ يقع على أمرٍ **أُرسل**. ومسوّدةٌ تُستلَم تعني بضاعةً
        -- دخلت بلا أن تُطلب.
        if v_po_status not in ('placed','partially_received') then
          raise exception 'zadim: لا استلامَ على أمرٍ حالتُه %', v_po_status;
        end if;

        update "zadim_purchase_order_line"
           set "quantity_received" = "quantity_received" + new."quantity",
               "updated_at" = now()
         where "id" = new."purchase_order_line_id"
           and "purchase_order_id" = new."purchase_order_id";

        if not found then
          raise exception 'zadim: سطرُ الإيصال لا ينتمي إلى هذا الأمر';
        end if;

        -- اكتملت كلُّ السطور؟ يُقفل الأمر. وإلا فجزئيٌّ.
        select count(*) into v_open
          from "zadim_purchase_order_line"
         where "purchase_order_id" = new."purchase_order_id"
           and "deleted_at" is null
           and "quantity_received" < "quantity_ordered";

        update "zadim_purchase_order"
           set "status"      = case when v_open = 0 then 'received' else 'partially_received' end,
               "received_at" = case when v_open = 0 then now() else "received_at" end,
               "updated_at"  = now()
         where "id" = new."purchase_order_id";

        return new;
      end $$;
    `);
    this.addSql(`drop trigger if exists "zadim_apply_purchase_receipt_trg" on "zadim_purchase_receipt";`);
    this.addSql(`
      create trigger "zadim_apply_purchase_receipt_trg"
        after insert on "zadim_purchase_receipt"
        for each row execute function "zadim_apply_purchase_receipt"();
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_apply_purchase_receipt_trg" on "zadim_purchase_receipt";`);
    this.addSql(`drop trigger if exists "zadim_freeze_po_line_trg" on "zadim_purchase_order_line";`);
    this.addSql(`drop trigger if exists "zadim_guard_po_transition_trg" on "zadim_purchase_order";`);
    this.addSql(`drop function if exists "zadim_apply_purchase_receipt"();`);
    this.addSql(`drop function if exists "zadim_freeze_po_line"();`);
    this.addSql(`drop function if exists "zadim_guard_po_transition"();`);
    this.addSql(`drop table if exists "zadim_purchase_receipt" cascade;`);
    this.addSql(`drop table if exists "zadim_purchase_order_line" cascade;`);
    this.addSql(`drop table if exists "zadim_purchase_order" cascade;`);
    this.addSql(`drop table if exists "zadim_supplier_variant" cascade;`);
    this.addSql(`drop table if exists "zadim_supplier" cascade;`);
  }
}
