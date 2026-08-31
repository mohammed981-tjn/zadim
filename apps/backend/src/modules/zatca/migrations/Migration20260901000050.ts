import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة zatca — الفواتيرُ الإلكترونية وسلسلتُها.
 *
 * ── ما يحرسه المُطلِق، وما لا يستطيع ────────────────────────────
 *
 * السلسلةُ تتطلّب أربعةَ ثوابت:
 *
 * ١. **التسلسلُ غيرُ منقطع** — لا فجوةَ ولا تكرار.
 * ٢. **كلُّ فاتورةٍ تحمل تجزئةَ التي قبلها**.
 * ٣. **الصادرُ لا يُعدَّل** — ولا حتى بجملة `UPDATE`.
 * ٤. **ولا يُحذف** — فالفجوةُ تُفسَّر للهيئة.
 *
 * والأربعةُ في القاعدة لا في الكود: فاتورةٌ تُكتب من سكربتٍ أو من
 * `psql` تكسر السلسلةَ كما تكسرها من مسارٍ منسيّ.
 *
 * ⚠️ **وما لا يستطيعه المُطلِق**: حسابُ التجزئة. لا `pgcrypto` مضموناً
 * على كل بيئةٍ نشرٍ، والحسابُ في القاعدة يضاعف موضعَ الحقيقة. فالتجزئةُ
 * تُحسب في الخدمة، **ويتحقّق المُطلِقُ من الاتّصال** — التسلسلُ يساوي
 * ما قبله + ١، وتجزئةُ السابقة تطابق. والدالّةُ الخالصة `verifyChain`
 * تعيد الحسابَ كاملاً في البوّابة.
 */
export class Migration20260901000050 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_zatca_setting" (
        "id"                      text not null,
        "seller_name"             text not null,
        "vat_number"              text not null,
        "address_street"          text null,
        "address_district"        text null,
        "address_city"            text null,
        "address_postal_code"     text null,
        "address_building_number" text null,
        "commercial_registration" text null,
        "phase"                   text not null default 'phase_1',
        "provider_id"             text null,
        "is_enabled"              boolean not null default false,
        "created_at"              timestamptz not null default now(),
        "updated_at"              timestamptz not null default now(),
        "deleted_at"              timestamptz null,
        constraint "zadim_zatca_setting_pkey" primary key ("id"),
        constraint "zadim_zatca_setting_phase_check" check ("phase" in ('phase_1','phase_2')),
        -- الرقمُ الضريبيّ السعوديّ خمسةَ عشرَ رقماً. والقيدُ على الشكل
        -- لا على المضمون: صحّةُ الرقم تُتحقَّق عند الهيئة، وهذا يمنع
        -- الخطأَ الطباعيَّ الذي يُطبع على كل فاتورة.
        constraint "zadim_zatca_setting_vat_check" check ("vat_number" ~ '^[0-9]{15}$')
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_zatca_setting_single"
        on "zadim_zatca_setting" ((true)) where deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_zatca_invoice" (
        "id"            text not null,
        "sequence"      bigint not null,
        "uuid"          text not null,
        "order_id"      text not null,
        "issued_at"     timestamptz not null,
        "currency_code" text not null,
        "total"         integer not null,
        "vat_total"     integer not null,
        "payload"       jsonb not null,
        "previous_hash" text not null,
        "invoice_hash"  text not null,
        "qr_base64"     text not null,
        "status"        text not null default 'issued',
        "provider_ref"  text null,
        "last_error"    text null,
        "created_at"    timestamptz not null default now(),
        "updated_at"    timestamptz not null default now(),
        "deleted_at"    timestamptz null,
        constraint "zadim_zatca_invoice_pkey" primary key ("id"),
        constraint "zadim_zatca_invoice_status_check"
          check ("status" in ('issued','reported','cleared','failed')),
        constraint "zadim_zatca_invoice_seq_check" check ("sequence" >= 1),
        constraint "zadim_zatca_invoice_amounts_check"
          check ("total" >= 0 and "vat_total" >= 0 and "vat_total" <= "total")
      );
    `);
    // فريدٌ بلا شرط `deleted_at`: رقمُ تسلسلٍ «حُذف ناعماً» ثم أُعيد
    // استعمالُه تكرارٌ في السلسلة، والحذفُ الناعم لا يُخفيه عن الهيئة.
    this.addSql(`
      create unique index if not exists "IDX_zadim_zatca_invoice_sequence"
        on "zadim_zatca_invoice" (sequence);
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_zatca_invoice_uuid"
        on "zadim_zatca_invoice" (uuid);
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_zatca_invoice_order"
        on "zadim_zatca_invoice" (order_id);
    `);

    // ── 🔴 اتّصالُ السلسلة عند الإدراج ──────────────────────────
    this.addSql(`
      create or replace function "zadim_guard_zatca_chain"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_last record;
      begin
        select "sequence", "invoice_hash" into v_last
          from "zadim_zatca_invoice"
         where "sequence" < new."sequence"
         order by "sequence" desc
         limit 1;

        if v_last is null then
          if new."sequence" <> 1 then
            raise exception
              'zadim: أوّلُ فاتورةٍ تسلسلُها ١ لا % — والفجوةُ من البداية فجوة', new."sequence"
              using errcode = 'check_violation';
          end if;
          return new;
        end if;

        if new."sequence" <> v_last."sequence" + 1 then
          raise exception
            'zadim: فجوةٌ في تسلسل الفواتير — % بعد %', new."sequence", v_last."sequence"
            using errcode = 'check_violation';
        end if;

        if new."previous_hash" is distinct from v_last."invoice_hash" then
          raise exception
            'zadim: السلسلةُ منقطعة — تجزئةُ الفاتورة % لا تشير إلى %', new."sequence", v_last."sequence"
            using errcode = 'check_violation';
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_zatca_chain_trg" on "zadim_zatca_invoice";`);
    this.addSql(`
      create trigger "zadim_guard_zatca_chain_trg"
        before insert on "zadim_zatca_invoice"
        for each row execute function "zadim_guard_zatca_chain"();
    `);

    // ── الصادرُ لا يُعدَّل إلا في حالة الإبلاغ ─────────────────
    this.addSql(`
      create or replace function "zadim_guard_zatca_immutable"()
      returns trigger
      language plpgsql
      as $$
      begin
        if new."sequence"      is distinct from old."sequence"
           or new."uuid"          is distinct from old."uuid"
           or new."order_id"      is distinct from old."order_id"
           or new."issued_at"     is distinct from old."issued_at"
           or new."total"         is distinct from old."total"
           or new."vat_total"     is distinct from old."vat_total"
           or new."payload"       is distinct from old."payload"
           or new."previous_hash" is distinct from old."previous_hash"
           or new."invoice_hash"  is distinct from old."invoice_hash"
           or new."qr_base64"     is distinct from old."qr_base64" then
          raise exception
            'zadim: فاتورةٌ صادرة لا تُعدَّل (تسلسل %) — يتغيّر منها حالُ الإبلاغ وحدَه', old."sequence"
            using errcode = 'check_violation';
        end if;
        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_zatca_immutable_trg" on "zadim_zatca_invoice";`);
    this.addSql(`
      create trigger "zadim_guard_zatca_immutable_trg"
        before update on "zadim_zatca_invoice"
        for each row execute function "zadim_guard_zatca_immutable"();
    `);
    this.addSql(`create or replace rule "zadim_zatca_invoice_no_delete" as
                 on delete to "zadim_zatca_invoice" do instead nothing;`);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_zatca_chain','zadim_zatca_invoice','zadim_guard_zatca_chain_trg',
         'تسلسلُ الفواتير غيرُ منقطع وكلُّ فاتورةٍ تشير إلى ما قبلها — ولا يُضاف ذلك بأثرٍ رجعيّ'),
        ('intg_zatca_imm','zadim_zatca_invoice','zadim_guard_zatca_immutable_trg',
         'فاتورةٌ صادرة لا تُعدَّل ولا تُحذف — يتغيّر منها حالُ الإبلاغ وحدَه')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_zatca_immutable_trg" on "zadim_zatca_invoice";`);
    this.addSql(`drop function if exists "zadim_guard_zatca_immutable"();`);
    this.addSql(`drop trigger if exists "zadim_guard_zatca_chain_trg" on "zadim_zatca_invoice";`);
    this.addSql(`drop function if exists "zadim_guard_zatca_chain"();`);
    this.addSql(`delete from "zadim_integrity_check"
                  where "id" in ('intg_zatca_chain','intg_zatca_imm');`);
    this.addSql(`drop table if exists "zadim_zatca_invoice" cascade;`);
    this.addSql(`drop table if exists "zadim_zatca_setting" cascade;`);
  }
}
