import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * دفترُ القيود (البند ١٫٣) — **والتوازنُ يقع عند الالتزام**.
 *
 * ── الثابتُ الذي لا يُحرس بغير هذا ───────────────────────────────
 *
 * «قيدٌ لا يتوازن لا يُكتب.»
 *
 * ⚠️ ولا يمكن حراستُه بـ`check` ولا بمُطلِقٍ عاديّ: كلاهما يرى **صفّاً
 * واحداً**، والتوازنُ خاصّةُ مجموعة. ومُطلِقٌ بعد كلّ إدراجٍ يرفض
 * السطرَ الأوّل دائماً — لأن قيداً من سطرٍ واحدٍ لا يتوازن أبداً بحكم
 * التعريف.
 *
 * فالأداةُ الصحيحةُ **قيدُ مُطلِقٍ مؤجَّل**
 * (`constraint trigger … deferrable initially deferred`): يُنادى مرّةً
 * **عند COMMIT** بعد أن تُكتب السطورُ كلُّها. فمعاملةٌ تكتب نصفَ قيدٍ
 * ثم تلتزم **تفشل**، ومعاملةٌ تكتب السطورَ بأيّ ترتيبٍ تنجح.
 *
 * 🔴 وهذا يجعل «الدفترُ متوازنٌ» **خاصّةَ القاعدة** لا عادةَ الكود:
 * لا سبيلَ إلى قيدٍ مختلٍّ من أيّ مسار — سيرِ عملٍ، أو سكربت، أو
 * `psql` بيدِ مشغّل.
 */
export class Migration20260904000050 extends Migration {
  async up(): Promise<void> {
    // ── ١) دليلُ الحسابات — بياناتٌ لا كود ─────────────────────
    this.addSql(`
      create table if not exists "zadim_ledger_account" (
        "id"          text not null,
        "name_ar"     text not null,
        "type"        text not null,
        "normal_side" text not null,
        "is_active"   boolean not null default true,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "zadim_ledger_account_pkey" primary key ("id"),
        constraint "zadim_ledger_account_type_check"
          check ("type" in ('asset','liability','equity','revenue','expense')),
        constraint "zadim_ledger_account_side_check"
          check ("normal_side" in ('debit','credit'))
      );
    `);

    // حساباتُ البداية. وما ينقص يُضاف صفّاً لا هجرة.
    this.addSql(`
      insert into "zadim_ledger_account" ("id","name_ar","type","normal_side") values
        ('receivable',       'ذممُ العملاء',            'asset',     'debit'),
        ('cash',             'النقدُ والمحصَّل',         'asset',     'debit'),
        ('revenue_items',    'إيرادُ الأصناف',          'revenue',   'credit'),
        ('revenue_shipping', 'إيرادُ الشحن',            'revenue',   'credit'),
        ('discount',         'الخصوماتُ الممنوحة',      'expense',   'debit'),
        ('vat_payable',      'ضريبةُ القيمة المضافة',   'liability', 'credit'),
        ('supplier_payable', 'ذممُ المورّدين',          'liability', 'credit'),
        ('inventory',        'المخزون',                 'asset',     'debit'),
        ('loyalty_liability','التزامُ نقاط الولاء',     'liability', 'credit'),
        ('adjustment',       'تسوياتٌ محاسبية',         'expense',   'debit')
      on conflict do nothing;
    `);

    // ── ٢) القيدُ وسطورُه ──────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_ledger_transaction" (
        "id"             text not null,
        "kind"           text not null,
        "source"         text not null,
        "reference_type" text not null,
        "reference_id"   text not null,
        "actor_id"       text null,
        "currency_code"  text not null,
        "occurred_at"    timestamptz not null,
        "note"           text null,
        "created_at"     timestamptz not null default now(),
        "updated_at"     timestamptz not null default now(),
        "deleted_at"     timestamptz null,
        constraint "zadim_ledger_transaction_pkey" primary key ("id"),
        constraint "zadim_ledger_transaction_kind_check"
          check ("kind" in ('sale','payment','refund','supplier_payment','loyalty','adjustment'))
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_ledger_tx_reference"
        on "zadim_ledger_transaction" ("reference_type", "reference_id");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_ledger_tx_kind"
        on "zadim_ledger_transaction" ("kind");
    `);

    this.addSql(`
      create table if not exists "zadim_ledger_entry" (
        "id"             text not null,
        "transaction_id" text not null,
        "account"        text not null,
        "amount"         bigint not null,
        "currency_code"  text not null,
        "note"           text null,
        "created_at"     timestamptz not null default now(),
        "updated_at"     timestamptz not null default now(),
        "deleted_at"     timestamptz null,
        constraint "zadim_ledger_entry_pkey" primary key ("id"),
        constraint "zadim_ledger_entry_tx_fk"
          foreign key ("transaction_id") references "zadim_ledger_transaction" ("id")
          on delete no action,
        -- 🔴 والحسابُ **مفتاحٌ أجنبيّ** لا نصٌّ حر: اسمٌ يُخترع في سطر
        -- كود (revenue_item بلا s) يُنشئ حساباً شبحاً لا يظهر في أيّ
        -- تقرير، والمالُ يذهب إليه بصمت.
        constraint "zadim_ledger_entry_account_fk"
          foreign key ("account") references "zadim_ledger_account" ("id")
          on delete no action,
        -- ولا قيدَ بصفر: سطرٌ بلا مبلغٍ ضجيجٌ يُخفي ما يهمّ.
        constraint "zadim_ledger_entry_nonzero" check ("amount" <> 0)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_ledger_entry_tx"
        on "zadim_ledger_entry" ("transaction_id");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_ledger_entry_account"
        on "zadim_ledger_entry" ("account");
    `);

    // ── ٣) يُلحَق ولا يُمسّ ─────────────────────────────────────
    //
    // نفسُ نمط سجلّ التدقيق وحركات المخزون وإيصالات الشراء ودفتر
    // المحاولات. والتصحيحُ **بقيدٍ مقابل** لا بمسحِ الماضي.
    for (const t of ["zadim_ledger_transaction", "zadim_ledger_entry"]) {
      this.addSql(`
        create or replace rule "${t}_no_update" as
          on update to "${t}" do instead nothing;
      `);
      this.addSql(`
        create or replace rule "${t}_no_delete" as
          on delete to "${t}" do instead nothing;
      `);
    }

    // ── ٤) 🔴 التوازنُ — قيدُ مُطلِقٍ **مؤجَّلٌ إلى الالتزام** ──
    this.addSql(`
      create or replace function "zadim_assert_ledger_balanced"()
      returns trigger language plpgsql as $$
      declare
        v_tx     text;
        v_sum    bigint;
        v_lines  int;
        v_curr   int;
      begin
        v_tx := coalesce(new."transaction_id", old."transaction_id");

        select coalesce(sum("amount"),0), count(*), count(distinct "currency_code")
          into v_sum, v_lines, v_curr
          from "zadim_ledger_entry"
         where "transaction_id" = v_tx and "deleted_at" is null;

        -- قيدٌ بلا سطورٍ: لا شيءَ يُفحص (حُذفت المعاملةُ كلُّها).
        if v_lines = 0 then
          return null;
        end if;

        -- ⚠️ وسطرٌ واحدٌ لا يكون قيداً: لا شيءَ يقابله.
        if v_lines < 2 then
          raise exception 'قيدٌ من سطرٍ واحدٍ لا يتوازن (%): لا شيءَ يقابله', v_tx;
        end if;

        -- ولا يُجمع ريالٌ إلى دولار: التوازنُ داخل عملةٍ واحدة.
        if v_curr > 1 then
          raise exception 'قيدٌ بعملتين (%) — والتوازنُ داخل عملةٍ واحدة', v_tx;
        end if;

        if v_sum <> 0 then
          raise exception 'قيدٌ لا يتوازن (%): مجموعُ السطور % هللة وليس صفراً', v_tx, v_sum;
        end if;

        return null;
      end $$;
    `);

    // 🔴 **`deferrable initially deferred`** — وهو جوهرُ التصميم.
    //
    // لأن الفحصَ بعد كلّ إدراجٍ يرفض السطرَ الأوّلَ دائماً: قيدٌ من
    // سطرٍ واحدٍ لا يتوازن بحكم التعريف. والمؤجَّلُ يُنادى مرّةً عند
    // COMMIT بعد أن تُكتب السطورُ كلُّها — فيقبل أيَّ ترتيبٍ، ويرفض
    // نصفَ قيدٍ التُزم به.
    this.addSql(`
      drop trigger if exists "zadim_assert_ledger_balanced_trg" on "zadim_ledger_entry";
      create constraint trigger "zadim_assert_ledger_balanced_trg"
        after insert on "zadim_ledger_entry"
        deferrable initially deferred
        for each row execute function "zadim_assert_ledger_balanced"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_ledger_balance','zadim_ledger_entry','zadim_assert_ledger_balanced_trg',
         'قيدٌ لا يتوازن لا يُلتزم — والفحصُ عند COMMIT لأن التوازن خاصّةُ مجموعةٍ لا صفّ'),
        ('intg_ledger_append','zadim_ledger_entry','zadim_ledger_entry_no_update',
         'الدفترُ يُلحَق ولا يُمسّ — والتصحيحُ بقيدٍ مقابل'),
        ('intg_ledger_account','zadim_ledger_entry','zadim_ledger_entry_account_fk',
         'لا حسابَ يُخترع في سطر كود — الحساباتُ صفوفٌ يحرسها مفتاحٌ أجنبيّ')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`delete from "zadim_integrity_check" where "id" like 'intg_ledger_%';`);
    this.addSql(`drop trigger if exists "zadim_assert_ledger_balanced_trg" on "zadim_ledger_entry";`);
    this.addSql(`drop function if exists "zadim_assert_ledger_balanced"();`);
    this.addSql(`drop table if exists "zadim_ledger_entry" cascade;`);
    this.addSql(`drop table if exists "zadim_ledger_transaction" cascade;`);
    this.addSql(`drop table if exists "zadim_ledger_account" cascade;`);
  }
}
