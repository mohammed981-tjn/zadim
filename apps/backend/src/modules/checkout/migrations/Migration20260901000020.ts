import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة checkout — العروضُ والمحاولات.
 *
 * ── ما يحرسه القيدُ وما لا يستطيع ───────────────────────────────
 *
 * قيدُ `idempotency_key` الفريد هو **كلُّ** حارس التكرار: ضغطتان
 * متتاليتان تصلان القاعدةَ معاً، والفحصُ في الكود يمرّ عليهما كليهما
 * لأن بين الفحص والكتابة يمرّ الآخر. والقيدُ يرى الاثنين.
 *
 * ⚠️ **وتوازنُ المجاميع ليس هنا، وذلك مقصودٌ مكتوب**: العقدُ يشترط
 * `totals_balance`، و**Medusa لا يخزّن مجاميع السلّة ولا الطلب** —
 * يحسبها عند القراءة من البنود وتسويّاتها وسطور ضريبتها. و`CHECK` لا
 * يحرس ما لا يُخزَّن. فالتوازنُ محروسٌ باختبارٍ في CI
 * (`verify-checkout.ts`)، ومكتوبٌ هنا أنه ليس قيداً — كي لا يظنّه
 * قارئٌ لاحقٌ مضموناً في القاعدة.
 *
 * وما **يُخزَّن فعلاً** في `order_summary.totals` يُحرس بقيدٍ حقيقيّ
 * أدناه.
 */
export class Migration20260901000020 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_cart_quote" (
        "id"                text not null,
        "cart_id"           text not null,
        "currency_code"     text not null,
        "item_total"        integer not null,
        "shipping_total"    integer not null,
        "tax_total"         integer not null,
        "discount_total"    integer not null,
        "total"             integer not null,
        "items_fingerprint" text not null,
        "lines"             jsonb null,
        "consumed_at"       timestamptz null,
        "created_at"        timestamptz not null default now(),
        "updated_at"        timestamptz not null default now(),
        "deleted_at"        timestamptz null,
        constraint "zadim_cart_quote_pkey" primary key ("id"),
        -- عرضٌ بمجاميعَ سالبة ليس عرضاً. والمبالغُ بالهللات صحيحةً
        -- (ADR-008)، فالنوعُ integer لا numeric: لا كسورَ تُقرَّب.
        constraint "zadim_cart_quote_amounts_check" check (
          "item_total" >= 0 and "shipping_total" >= 0 and
          "tax_total" >= 0 and "discount_total" >= 0 and "total" >= 0
        )
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_cart_quote_cart"
        on "zadim_cart_quote" (cart_id) where deleted_at is null;
    `);
    // البحثُ الفعليّ دائماً «آخرُ عرضٍ لم يُستهلك لهذه السلّة».
    this.addSql(`
      create index if not exists "IDX_zadim_cart_quote_open"
        on "zadim_cart_quote" (cart_id, created_at desc)
        where consumed_at is null and deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_checkout_attempt" (
        "id"              text not null,
        "idempotency_key" text not null,
        "cart_id"         text not null,
        "status"          text not null default 'in_progress',
        "order_id"        text null,
        "response"        jsonb null,
        "error_code"      text null,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_checkout_attempt_pkey" primary key ("id"),
        constraint "zadim_checkout_attempt_status_check"
          check ("status" in ('in_progress','completed','failed'))
      );
    `);
    // 🔴 هذا القيدُ **هو** حارسُ «لا يُحصَّل مرّتين». وفهرسٌ فريدٌ بلا
    // شرط `deleted_at`: مفتاحٌ حُذف ناعماً ثم أُعيد استعمالُه يُنتج
    // طلباً ثانياً — والحذفُ الناعم لا يُبطل وعداً قُطع للعميل.
    this.addSql(`
      create unique index if not exists "IDX_zadim_checkout_attempt_key_unique"
        on "zadim_checkout_attempt" (idempotency_key);
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_checkout_attempt_cart"
        on "zadim_checkout_attempt" (cart_id) where deleted_at is null;
    `);

    // ── ما يُخزَّن فعلاً: مجاميعُ الطلب في `order_summary.totals` ──
    //
    // القيدُ **مشروطٌ بوجود المفاتيح** (`?`): شكلُ هذا الحقل يملكه
    // Medusa وقد يتغيّر بترقية. وقيدٌ يفترض شكلاً ثابتاً يُسقط الترقيةَ
    // كلَّها — والحارسُ الذي يُسقط النظام ليحمي حقلاً يُنزع بعد أسبوع.
    //
    // ولا يُفرض هنا إلا **ما هو يقينيّ**: لا مجاميعَ سالبة، ولا
    // استردادَ يتجاوز المحصَّل. أما `pending_difference = total −
    // transaction − credit` فمُؤجَّلٌ إلى المرحلة ٦ **لأنه لم يُقَس**:
    // كلُّ ما رأيناه أصفارٌ (لا دفعَ بعد)، وقيدٌ يُشتقّ من عيّنةٍ
    // صفريّةٍ واحدة يرفض أوّلَ استردادٍ حقيقيّ.
    this.addSql(`
      alter table "order_summary"
        add constraint "zadim_order_totals_sane" check (
          (not (totals ? 'original_order_total') or (totals->>'original_order_total')::numeric >= 0) and
          (not (totals ? 'current_order_total')  or (totals->>'current_order_total')::numeric  >= 0) and
          (not (totals ? 'paid_total')           or (totals->>'paid_total')::numeric           >= 0) and
          (not (totals ? 'refunded_total')       or (totals->>'refunded_total')::numeric       >= 0) and
          (not (totals ? 'paid_total' and totals ? 'refunded_total')
             or (totals->>'refunded_total')::numeric <= (totals->>'paid_total')::numeric)
        ) not valid;
    `);
    this.addSql(`alter table "order_summary" validate constraint "zadim_order_totals_sane";`);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_totals','order_summary','zadim_order_totals_sane',
              'مجاميعُ الطلب لا تكون سالبةً ولا يتجاوز المستردُّ المحصَّل — وما لا يُخزَّن يحرسه اختبارُ CI لا قيد')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`alter table "order_summary" drop constraint if exists "zadim_order_totals_sane";`);
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_totals';`);
    this.addSql(`drop table if exists "zadim_checkout_attempt" cascade;`);
    this.addSql(`drop table if exists "zadim_cart_quote" cascade;`);
  }
}
