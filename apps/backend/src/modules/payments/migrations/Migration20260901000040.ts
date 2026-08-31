import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة payments — سياسةُ COD، وحارسُ التكرار، **وتوقيتُ التحصيل**.
 *
 * ── البندُ الأول في بوّابة المرحلة ٦ ────────────────────────────
 *
 * > «التحصيلُ عند **الشحن** لا عند الطلب.»
 *
 * وهو ليس تفضيلاً محاسبياً. متجرٌ يُحصّل عند الطلب ثم يعجز عن الشحن
 * **يملك مالَ العميل ولا بضاعةَ عنده**: فيلزمه استردادٌ ورسومُ مزوّدٍ
 * على العملية ذهاباً وإياباً، وعميلٌ ينتظر أيّاماً لمالٍ لم يُشترَ به
 * شيء. والتحصيلُ عند الشحن يجعل الإلغاءَ قبله **بلا كلفةٍ على أحد**
 * (`03-state-machines.md` §٢).
 *
 * ── ولماذا مُطلِقٌ لا فحصٌ في سيرِ العمل ───────────────────────
 *
 * لأن التحصيلَ يقع من أماكنَ كثيرة: مسارُ الإدارة، ومحوّلُ المزوّد حين
 * يصله webhook، وسكربتُ تسويةٍ يدويّة. وفحصٌ في واحدٍ منها لا يحرس
 * البقية — **والمالُ الذي يُؤخذ قبل أوانه لا يُعاد بضغطة**.
 *
 * ⚠️ **والقيدُ لا يُفرض إلا حين يكون للدفعة طلبٌ مرتبط**: دفعةٌ بلا طلب
 * (تسويةٌ يدويّة، أو رصيدُ متجر) ليست بيعاً ينتظر شحنة. وفرضُه عليها
 * يُسقط عملياتٍ سليمةً لسببٍ لا يخصّها.
 */
export class Migration20260901000040 extends Migration {
  async up(): Promise<void> {
    // ── سياسةُ COD ───────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_cod_policy" (
        "id"                    text not null,
        "is_enabled"            boolean not null default true,
        "max_order_total"       integer null,
        "min_order_total"       integer null,
        "refusals_before_block" integer null,
        "excluded_cities"       text[] null,
        "note"                  text null,
        "created_at"            timestamptz not null default now(),
        "updated_at"            timestamptz not null default now(),
        "deleted_at"            timestamptz null,
        constraint "zadim_cod_policy_pkey" primary key ("id"),
        constraint "zadim_cod_policy_amounts_check" check (
          ("max_order_total" is null or "max_order_total" >= 0) and
          ("min_order_total" is null or "min_order_total" >= 0) and
          ("refusals_before_block" is null or "refusals_before_block" >= 1) and
          ("max_order_total" is null or "min_order_total" is null
             or "min_order_total" <= "max_order_total")
        )
      );
    `);
    // سياسةٌ واحدةٌ نافذة: نسختان بحدّين مختلفين تجعلان الحكمَ يعتمد
    // على أيِّهما قُرئت أوّلاً.
    this.addSql(`
      create unique index if not exists "IDX_zadim_cod_policy_single"
        on "zadim_cod_policy" ((true)) where deleted_at is null;
    `);

    // ── الرفضات ─────────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_cod_refusal" (
        "id"           text not null,
        "customer_key" text not null,
        "customer_id"  text null,
        "order_id"     text null,
        "reason_ar"    text null,
        "recorded_by"  text null,
        "created_at"   timestamptz not null default now(),
        "updated_at"   timestamptz not null default now(),
        "deleted_at"   timestamptz null,
        constraint "zadim_cod_refusal_pkey" primary key ("id"),
        constraint "zadim_cod_refusal_key_check" check (length("customer_key") > 0)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_cod_refusal_key"
        on "zadim_cod_refusal" (customer_key);
    `);
    // واقعةٌ وقعت. ومن أراد الصفحَ يرفع العتبةَ في السياسة، ولا يمحو
    // التاريخَ الذي بُنيت عليه.
    this.addSql(`create or replace rule "zadim_cod_refusal_no_update" as
                 on update to "zadim_cod_refusal" do instead nothing;`);
    this.addSql(`create or replace rule "zadim_cod_refusal_no_delete" as
                 on delete to "zadim_cod_refusal" do instead nothing;`);

    // ── حارسُ التكرار على المال ─────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_money_operation" (
        "id"              text not null,
        "idempotency_key" text not null,
        "kind"            text not null,
        "payment_id"      text null,
        "order_id"        text null,
        "amount"          integer not null,
        "status"          text not null default 'in_progress',
        "result"          jsonb null,
        "error_code"      text null,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_money_operation_pkey" primary key ("id"),
        constraint "zadim_money_operation_kind_check"
          check ("kind" in ('capture','refund','void')),
        constraint "zadim_money_operation_status_check"
          check ("status" in ('in_progress','completed','failed')),
        constraint "zadim_money_operation_amount_check" check ("amount" >= 0)
      );
    `);
    // 🔴 القيدُ **هو** الحارس. وبلا شرط `deleted_at`: مفتاحٌ حُذف ناعماً
    // ثم أُعيد استعمالُه يُحصّل مرّةً ثانية.
    this.addSql(`
      create unique index if not exists "IDX_zadim_money_operation_key"
        on "zadim_money_operation" (idempotency_key);
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_money_operation_payment"
        on "zadim_money_operation" (payment_id) where deleted_at is null;
    `);

    // ── 🔴 توقيتُ التحصيل ───────────────────────────────────────
    this.addSql(`
      create or replace function "zadim_guard_capture_timing"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_order_id text;
        v_shipped  int;
      begin
        select opc."order_id" into v_order_id
          from "payment" p
          join "order_payment_collection" opc
            on opc."payment_collection_id" = p."payment_collection_id"
           and opc."deleted_at" is null
         where p."id" = new."payment_id"
         limit 1;

        -- دفعةٌ بلا طلب: تسويةٌ أو رصيدُ متجر. ليست بيعاً ينتظر شحنة.
        if v_order_id is null then
          return null;
        end if;

        select count(*) into v_shipped
          from "order_fulfillment" ofu
          join "fulfillment" f on f."id" = ofu."fulfillment_id"
         where ofu."order_id" = v_order_id
           and f."shipped_at" is not null
           and f."canceled_at" is null;

        if v_shipped = 0 then
          raise exception
            'zadim: لا تحصيلَ قبل الشحن (طلب %) — ما يُلغى قبل الشحن لا يُحصَّل فلا استردادَ ولا رسوم', v_order_id
            using errcode = 'check_violation';
        end if;

        return null;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_capture_timing_trg" on "capture";`);
    this.addSql(`
      create trigger "zadim_guard_capture_timing_trg"
        after insert on "capture"
        for each row execute function "zadim_guard_capture_timing"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_capture','capture','zadim_guard_capture_timing_trg',
              'لا تحصيلَ قبل شحن الطلب — فما يُلغى قبل الشحن لا يُحصَّل ولا يحتاج استرداداً')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_capture_timing_trg" on "capture";`);
    this.addSql(`drop function if exists "zadim_guard_capture_timing"();`);
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_capture';`);
    this.addSql(`drop table if exists "zadim_money_operation" cascade;`);
    this.addSql(`drop table if exists "zadim_cod_refusal" cascade;`);
    this.addSql(`drop table if exists "zadim_cod_policy" cascade;`);
  }
}
