import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة marketing — الجداول، ثم **المُطلِقات التي هي البوّابة**.
 *
 * > البوّابة: السلةُ المتروكة · انخفاضُ السعر · عودةُ التوفّر ·
 * > الشرائح — **كلُّها من `outbox_events` لا من مهامّ تمسح الجداول**.
 */
export class Migration20260901000100 extends Migration {
  async up(): Promise<void> {
    // ── ١) الشرائح ──────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_customer_segment" (
        "id"          text not null,
        "name_ar"     text not null,
        "name_en"     text null,
        "definition"  jsonb not null,
        "is_active"   boolean not null default true,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "zadim_customer_segment_pkey" primary key ("id")
      );
    `);

    // ── ٢) القوالب ──────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_notification_template" (
        "id"          text not null,
        "event"       text not null,
        "channel"     text not null,
        "subject_ar"  text null,
        "subject_en"  text null,
        "body_ar"     text not null,
        "body_en"     text null,
        "is_active"   boolean not null default true,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "zadim_notification_template_pkey" primary key ("id"),
        constraint "zadim_notification_template_channel_check"
          check ("channel" in ('email','sms','push')),
        -- نصٌّ فارغٌ ليس قالباً: رسالةٌ بيضاءُ تصل العميلَ أسوأُ من
        -- رسالةٍ لا تصل.
        constraint "zadim_notification_template_body_check"
          check (length(btrim("body_ar")) > 0)
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_notification_template_event_channel"
        on "zadim_notification_template" ("event","channel") where "deleted_at" is null;
    `);

    // ── ٣) سجلُّ الإرسال ────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_notification_send" (
        "id"          text not null,
        "send_key"    text not null,
        "event_id"    text not null,
        "channel"     text not null,
        "recipient"   text not null,
        "status"      text not null default 'queued',
        "provider"    text null,
        "error"       text null,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "zadim_notification_send_pkey" primary key ("id"),
        constraint "zadim_notification_send_status_check"
          check ("status" in ('queued','sent','failed','suppressed'))
      );
    `);
    // 🔴 **القيدُ هو الحارس** لا الفحصُ قبل الكتابة (ADR-014): بين
    // «هل أُرسلت؟» و«أرسِلها» يمرّ النداءُ الثاني.
    this.addSql(`
      create unique index if not exists "IDX_zadim_notification_send_key"
        on "zadim_notification_send" ("send_key");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_notification_send_event"
        on "zadim_notification_send" ("event_id");
    `);

    // ── ٤) 🔴 جدولُ التذكيرات — **خطّةٌ لا واقعة** ───────────────
    //
    // وهذا الجدولُ وُلد من **اصطدامٍ بحارسٍ قديم**، وهو أفضلُ ما في
    // الدفعة. أوّلُ تصميمٍ جعل «السلّة المتروكة» حدثاً في الصندوق
    // موعدُه في المستقبل، ويُؤخَّر موعدُه مع كل تغيير. فرفضه مُطلِقُ
    // المرحلة ٥: **«حدثٌ وقع لا يُعاد كتابتُه»**.
    //
    // والحارسُ كان مصيباً والتصميمُ مخطئاً: حدثٌ `occurred_at`ه في
    // المستقبل **كذبٌ في الاسم** — لم يقع شيءٌ بعد. وكنتُ أخلط أمرين:
    // **متى وقع الأمر** (واقعةٌ لا تتغيّر) و**متى نُذكِّر** (خطّةٌ
    // تتغيّر بطبعها).
    //
    // ففُصلا: الصندوقُ دفترُ وقائعَ لا يُعدَّل، وهذا جدولُ خططٍ يُعدَّل
    // — وموعدُه يتأخّر كلَّما تحرّكت السلّة. ولا يزال «من الصندوق لا من
    // مَسحٍ»: تُقرأ التذكيراتُ المستحقّةُ بفهرسٍ على الوقت، ولا يُمسح
    // جدولُ السلال بحثاً عن مرشَّحين.
    this.addSql(`
      create table if not exists "zadim_scheduled_reminder" (
        "id"            text not null,
        "kind"          text not null,
        "aggregate_id"  text not null,
        "due_at"        timestamptz not null,
        "payload"       jsonb null,
        "fired_at"      timestamptz null,
        "canceled_at"   timestamptz null,
        "cancel_reason" text null,
        "created_at"    timestamptz not null default now(),
        "updated_at"    timestamptz not null default now(),
        "deleted_at"    timestamptz null,
        constraint "zadim_scheduled_reminder_pkey" primary key ("id")
      );
    `);
    // تذكيرٌ **حيٌّ واحدٌ** لكل سلّة: عشرُ إضافاتٍ تعني موعداً يتأخّر
    // عشرَ مرّاتٍ لا عشرةَ تذكيرات. وإلا وصلت العميلَ عشرُ رسائل.
    this.addSql(`
      create unique index if not exists "IDX_zadim_scheduled_reminder_live"
        on "zadim_scheduled_reminder" ("kind","aggregate_id")
        where "fired_at" is null and "canceled_at" is null and "deleted_at" is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_scheduled_reminder_due"
        on "zadim_scheduled_reminder" ("due_at")
        where "fired_at" is null and "canceled_at" is null;
    `);

    // ── ٥) انخفاضُ السعر ────────────────────────────────────────
    //
    // ولا يُطلَق على الارتفاع: العميلُ الذي وضع صنفاً في مفضّلته يريد
    // أن يعلم حين يرخص، لا حين يغلو.
    this.addSql(`
      create or replace function "zadim_emit_price_drop"()
      returns trigger
      language plpgsql
      as $$
      begin
        if new."amount" >= old."amount" then
          return new;
        end if;

        insert into "zadim_outbox_event" (
          "id","event","aggregate_type","aggregate_id","payload","occurred_at"
        ) values (
          'evt_' || replace(gen_random_uuid()::text, '-', ''),
          'PriceDropped',
          'price',
          new."id",
          jsonb_build_object(
            'price_id', new."id",
            'price_set_id', new."price_set_id",
            'currency_code', new."currency_code",
            'old_amount', old."amount",
            'new_amount', new."amount",
            'drop', old."amount" - new."amount"
          ),
          now()
        );

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_emit_price_drop_trg" on "price";`);
    this.addSql(`
      create trigger "zadim_emit_price_drop_trg"
        after update of "amount" on "price"
        for each row execute function "zadim_emit_price_drop"();
    `);

    // ── ٦) عودةُ التوفّر ────────────────────────────────────────
    //
    // ⚠️ **الحدُّ هو العبور من صفرٍ إلى موجب، لا كلُّ زيادة.** فمخزونٌ
    // من خمسٍ صار ثمانياً لم «يعد»: كان متاحاً طولَ الوقت. ولو أُطلق
    // على كل زيادةٍ لوصلت رسالةُ «عاد التوفّر» بعد كل استلامِ بضاعة،
    // فيتعلّم العميلُ تجاهلَها — ثم لا يقرؤها يوم تعني شيئاً.
    this.addSql(`
      create or replace function "zadim_emit_back_in_stock"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_old integer;
        v_new integer;
      begin
        v_old := old."stocked_quantity" - old."reserved_quantity";
        v_new := new."stocked_quantity" - new."reserved_quantity";

        if v_old > 0 or v_new <= 0 then
          return new;
        end if;

        insert into "zadim_outbox_event" (
          "id","event","aggregate_type","aggregate_id","payload","occurred_at"
        ) values (
          'evt_' || replace(gen_random_uuid()::text, '-', ''),
          'BackInStock',
          'inventory_item',
          new."inventory_item_id",
          jsonb_build_object(
            'inventory_item_id', new."inventory_item_id",
            'location_id', new."location_id",
            'available', v_new
          ),
          now()
        );

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_emit_back_in_stock_trg" on "inventory_level";`);
    this.addSql(`
      create trigger "zadim_emit_back_in_stock_trg"
        after update of "stocked_quantity","reserved_quantity" on "inventory_level"
        for each row execute function "zadim_emit_back_in_stock"();
    `);

    // ── ٧) 🔴 السلّةُ المتروكة — تذكيرٌ يتأخّر، لا حدثٌ يُعاد كتابتُه ─
    //
    // انخفاضُ السعر تغيّرٌ يقع فيُكتب. أمّا «تركَ العميلُ سلّته» فهو
    // **غيابُ فعلٍ لا فعل**، ولا مُطلِقَ يُطلَق على ما لم يحدث.
    //
    // والحلُّ الساذجُ مَسحٌ دوريّ لجدول السلال («من لم يتحرّك منذ
    // ساعة») — وهو ما تمنعه البوّابة نصّاً. وعيبُه ليس لفظياً: يقرأ
    // **كلَّ** سلّةٍ في المتجر كلَّ دقيقةٍ ليجد واحدة، فيكبر عبؤه مع
    // نمو المتجر حتى يصير هو المشكلة.
    //
    // فكلُّ تغيّرٍ في السلّة **يجدّد موعدَ تذكيرٍ واحد** في جدول الخطط.
    // والمهلةُ **بيانات**: `zadim.cart_quiet_minutes` إن ضُبطت، وإلا
    // ستّون دقيقة — ولا رقمَ في الكود يحتاج نشرةً ليتغيّر (بند ٤٨).
    this.addSql(`
      create or replace function "zadim_schedule_cart_quiet"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_minutes integer;
        v_due     timestamptz;
        v_cart    text;
        v_updated integer;
      begin
        v_cart := new."cart_id";
        if v_cart is null then
          return new;
        end if;

        v_minutes := coalesce(
          nullif(current_setting('zadim.cart_quiet_minutes', true), '')::integer, 60
        );
        v_due := now() + make_interval(mins => v_minutes);

        update "zadim_scheduled_reminder"
           set "due_at" = v_due,
               "payload" = jsonb_build_object('cart_id', v_cart, 'quiet_minutes', v_minutes),
               "updated_at" = now()
         where "kind" = 'CartWentQuiet'
           and "aggregate_id" = v_cart
           and "fired_at" is null
           and "canceled_at" is null
           and "deleted_at" is null;

        get diagnostics v_updated = row_count;

        if v_updated = 0 then
          insert into "zadim_scheduled_reminder" (
            "id","kind","aggregate_id","due_at","payload"
          ) values (
            'rem_' || replace(gen_random_uuid()::text, '-', ''),
            'CartWentQuiet',
            v_cart,
            v_due,
            jsonb_build_object('cart_id', v_cart, 'quiet_minutes', v_minutes)
          );
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_schedule_cart_quiet_trg" on "cart_line_item";`);
    this.addSql(`
      create trigger "zadim_schedule_cart_quiet_trg"
        after insert or update on "cart_line_item"
        for each row execute function "zadim_schedule_cart_quiet"();
    `);

    // ومن أتمّ سلّتَه لا يُذكَّر بها. **ويُلغى التذكيرُ ولا يُحذف**:
    // «لماذا لم تصل الرسالة؟» سؤالٌ يُسأل، وجوابُه في الصفّ.
    this.addSql(`
      create or replace function "zadim_cancel_cart_quiet"()
      returns trigger
      language plpgsql
      as $$
      begin
        if new."completed_at" is null or old."completed_at" is not null then
          return new;
        end if;

        update "zadim_scheduled_reminder"
           set "canceled_at" = now(),
               "cancel_reason" = 'cart completed',
               "updated_at" = now()
         where "kind" = 'CartWentQuiet'
           and "aggregate_id" = new."id"
           and "fired_at" is null
           and "canceled_at" is null;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_cancel_cart_quiet_trg" on "cart";`);
    this.addSql(`
      create trigger "zadim_cancel_cart_quiet_trg"
        after update of "completed_at" on "cart"
        for each row execute function "zadim_cancel_cart_quiet"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_mkt_drop','price','zadim_emit_price_drop_trg',
         'انخفاضُ السعر حدثٌ يُكتب في نفس المعاملة — ولا يُطلَق على الارتفاع'),
        ('intg_mkt_stock','inventory_level','zadim_emit_back_in_stock_trg',
         'عودةُ التوفّر هي العبورُ من صفرٍ إلى موجب لا كلُّ زيادة'),
        ('intg_mkt_cart','cart_line_item','zadim_schedule_cart_quiet_trg',
         'السلّةُ المتروكة تذكيرٌ واحدٌ يتأخّر موعدُه — لا مَسحٌ دوريّ ولا تذكيرٌ لكل تغيير'),
        ('intg_mkt_done','cart','zadim_cancel_cart_quiet_trg',
         'ومن أتمّ سلّتَه لا يُذكَّر بها')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_cancel_cart_quiet_trg" on "cart";`);
    this.addSql(`drop trigger if exists "zadim_schedule_cart_quiet_trg" on "cart_line_item";`);
    this.addSql(`drop trigger if exists "zadim_emit_back_in_stock_trg" on "inventory_level";`);
    this.addSql(`drop trigger if exists "zadim_emit_price_drop_trg" on "price";`);
    this.addSql(`drop function if exists "zadim_cancel_cart_quiet"();`);
    this.addSql(`drop function if exists "zadim_schedule_cart_quiet"();`);
    this.addSql(`drop function if exists "zadim_emit_back_in_stock"();`);
    this.addSql(`drop function if exists "zadim_emit_price_drop"();`);
    this.addSql(`drop table if exists "zadim_scheduled_reminder" cascade;`);
    this.addSql(`drop table if exists "zadim_notification_send" cascade;`);
    this.addSql(`drop table if exists "zadim_notification_template" cascade;`);
    this.addSql(`drop table if exists "zadim_customer_segment" cascade;`);
    this.addSql(`delete from "zadim_integrity_check" where "id" like 'intg_mkt_%';`);
  }
}
