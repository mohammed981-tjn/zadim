import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * الإشعاراتُ الموثوقة — دفترُ المحاولات وحالةُ الشطب.
 *
 * ── الثابتُ الذي تحرسه هذه الهجرة ────────────────────────────────
 *
 * «رسالةٌ سُلّمت لا تُسلَّم مرّةً ثانية، ورسالةٌ شُطبت لا تُحيا.»
 *
 * وهذا ثابتٌ **لا يُحرس بشرطِ if في خدمة**: المُعيدُ قد يكون مهمّةً
 * مجدولةً، أو مشغّلاً في psql، أو نسختين من الخلفيّة تعملان معاً بعد
 * نشرٍ متدرّج. وشرطُ الخدمة يحرس المسارَ الذي مرّ به وحدَه.
 *
 * فالحراسةُ ثلاثةُ أطراف:
 *
 * ١. لا محاولةَ تُكتب على رسالةٍ حالتُها نهائية (sent · suppressed ·
 *    dead) — والإرسالُ المكرّر يصير **مستحيلَ التسجيل** لا ممنوعاً
 *    بالعرف.
 * ٢. لا حالةَ نهائيّةً تُحيا — والشطبُ يعني الشطب.
 * ٣. والعدّادُ تكتبه القاعدةُ من الدفتر، فلا ينحرف عنه أبداً.
 */
export class Migration20260904000041 extends Migration {
  async up(): Promise<void> {
    // ── ١) حقولُ الإعادة على سجلّ الإرسال ──────────────────────
    //
    // 🔴 و`subject`/`body` **ليسا زينةً**: بلا نصٍّ محفوظٍ لا تُعاد
    // رسالةٌ أصلاً — تُعاد رسالةٌ فارغة. والبديلُ (إعادةُ البناء من
    // القالب) مرفوض: قالبٌ عُدِّل بعد الواقعة يُرسل نصّاً **ثالثاً**
    // لا هو الأوّلُ ولا هو الجديد. فنصُّ الرسالة لحظةَ الحدث هو نصُّها.
    this.addSql(`
      alter table "zadim_notification_send"
        add column if not exists "subject" text null,
        add column if not exists "body" text not null default '',
        add column if not exists "attempts" integer not null default 0,
        add column if not exists "last_attempt_at" timestamptz null,
        add column if not exists "next_attempt_at" timestamptz null,
        add column if not exists "dead_at" timestamptz null;
    `);

    this.addSql(`
      alter table "zadim_notification_send"
        drop constraint if exists "zadim_notification_send_status_check";
    `);
    this.addSql(`
      alter table "zadim_notification_send"
        add constraint "zadim_notification_send_status_check"
        check ("status" in ('queued','sent','failed','suppressed','dead'));
    `);
    this.addSql(`
      alter table "zadim_notification_send"
        add constraint "zadim_notification_send_attempts_check" check ("attempts" >= 0);
    `);

    // فهرسُ المستحقّ للإعادة: يُقرأ ما استحقّ وحدَه لا كلُّ الجدول.
    // وجزئيٌّ لأن المُسلَّمَ والمشطوبَ لا يُقرآن أبداً — وهما الأكثرية
    // بعد شهر.
    this.addSql(`
      create index if not exists "IDX_zadim_notification_send_retriable"
        on "zadim_notification_send" ("next_attempt_at")
        where "status" in ('queued','failed');
    `);

    // ── ٢) دفترُ المحاولات ──────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_notification_attempt" (
        "id"         text not null,
        "send_id"    text not null,
        "attempt_no" integer not null,
        "status"     text not null,
        "provider"   text null,
        "error"      text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_notification_attempt_pkey" primary key ("id"),
        constraint "zadim_notification_attempt_no_check" check ("attempt_no" >= 1),
        -- 🔴 \`no action\` **لا** \`cascade\` — وهذا مقيسٌ لا مذهبيّ.
        --
        -- مع \`cascade\` يُصدر بوستجرس حذفاً على الابن، فتردّه قاعدةُ
        -- «لا حذف»، فيسقط فحصُ التكامل بـ«نتيجةٍ غيرِ متوقّعة» — ويصير
        -- صفُّ الإرسال **غيرَ قابلٍ للحذف أبداً**، حتى الذي لا دفترَ
        -- له. وأثرُه الحقيقيُّ أبعدُ من تنظيفِ بوّابة: \`recipient\`
        -- يحمل بريدَ عميل، وحقُّ المحو يصير مستحيلاً بنيةً.
        --
        -- ومع \`no action\` يقرأ بوستجرس الابنَ ولا يحذفه، فلا تعترضه
        -- القاعدة: صفٌّ له دفترٌ يُرفض حذفُه **بخطأٍ مقروء** (وهو
        -- المطلوب: الدفترُ لا يُيتَّم)، وصفٌّ بلا دفترٍ يُحذف. والمحوُ
        -- يصير بالكتابة فوق \`recipient\` لا بحذف الصفّ — وهو أصحّ
        -- أصلاً: الواقعةُ تبقى والهويّةُ تُمحى.
        constraint "zadim_notification_attempt_send_fk"
          foreign key ("send_id") references "zadim_notification_send" ("id") on delete no action
      );
    `);

    // 🔴 **الحكمُ في التزامن**: مُعيدان يعيدان نفسَ الرسالة في نفس
    // اللحظة يقرآن «آخرُ محاولةٍ ٢» معاً فيكتبان ٣ معاً — والفهرسُ
    // يجعل الثانيَ يصطدم بدل أن يُرسل نسخةً ثانية.
    this.addSql(`
      create unique index if not exists "IDX_zadim_notification_attempt_seq"
        on "zadim_notification_attempt" ("send_id", "attempt_no");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_notification_attempt_send"
        on "zadim_notification_attempt" ("send_id");
    `);

    // ── ٣) الدفترُ يُلحَق ولا يُمسّ ─────────────────────────────
    //
    // نفسُ نمط إيصالات الشراء وحركات المخزون: محاولةٌ وقعت لا تُعدَّل
    // ولا تُحذَف، والتصحيحُ بصفٍّ مقابل. والقاعدةُ تجعل ذلك بنيةً لا
    // عادةَ فريق.
    this.addSql(`
      create or replace rule "zadim_notification_attempt_no_update" as
        on update to "zadim_notification_attempt" do instead nothing;
    `);
    this.addSql(`
      create or replace rule "zadim_notification_attempt_no_delete" as
        on delete to "zadim_notification_attempt" do instead nothing;
    `);

    // ── ٤) المُطلِقُ الذي يمنع الإرسالَ مرّتين ──────────────────
    //
    // ⚠️ ويعمل **قبل** الإدراج: الرسالةُ التي سُلّمت أو شُطبت أو كُتمت
    // لا تُقبل لها محاولةٌ أصلاً. فالإرسالُ المكرّر لا يُمنع بعُرفٍ في
    // الخدمة بل يصير **مستحيلَ التسجيل** — ومن لا يستطيع تسجيلَ
    // المحاولة لا يستطيع إرسالَها، لأن التسجيلَ يسبق التسليم.
    this.addSql(`
      create or replace function "zadim_seq_notification_attempt"()
      returns trigger language plpgsql as $$
      declare
        v_status text;
        v_last   integer;
      begin
        -- قفلُ صفّ الأب: الحسابُ تحت القفل لا قراءةٌ ثم كتابة.
        select "status" into v_status
          from "zadim_notification_send" where "id" = new."send_id" for update;

        if v_status is null then
          raise exception 'محاولةٌ لسجلّ إرسالٍ غيرِ موجود: %', new."send_id";
        end if;

        if v_status in ('sent','suppressed','dead') then
          raise exception 'لا محاولةَ على رسالةٍ حالتُها نهائية (%) — الإرسالُ مرّتين ممنوعٌ بنيةً', v_status;
        end if;

        select coalesce(max("attempt_no"), 0) into v_last
          from "zadim_notification_attempt" where "send_id" = new."send_id";

        new."attempt_no" := v_last + 1;
        return new;
      end $$;
    `);
    this.addSql(`
      drop trigger if exists "zadim_seq_notification_attempt_trg" on "zadim_notification_attempt";
      create trigger "zadim_seq_notification_attempt_trg"
        before insert on "zadim_notification_attempt"
        for each row execute function "zadim_seq_notification_attempt"();
    `);

    // ── ٥) والعدّادُ من الدفتر لا من التطبيق ────────────────────
    this.addSql(`
      create or replace function "zadim_count_notification_attempt"()
      returns trigger language plpgsql as $$
      begin
        update "zadim_notification_send"
           set "attempts"        = new."attempt_no",
               "last_attempt_at" = now(),
               "updated_at"      = now()
         where "id" = new."send_id";
        return null;
      end $$;
    `);
    this.addSql(`
      drop trigger if exists "zadim_count_notification_attempt_trg" on "zadim_notification_attempt";
      create trigger "zadim_count_notification_attempt_trg"
        after insert on "zadim_notification_attempt"
        for each row execute function "zadim_count_notification_attempt"();
    `);

    // ── ٦) والحالةُ النهائيّةُ لا تُحيا ─────────────────────────
    this.addSql(`
      create or replace function "zadim_guard_notification_send"()
      returns trigger language plpgsql as $$
      begin
        if old."status" in ('sent','suppressed','dead')
           and new."status" is distinct from old."status" then
          raise exception 'حالةٌ نهائيّةٌ لا تُحيا: % ← %', old."status", new."status";
        end if;

        -- العدّادُ لا يرجع: محاولةٌ وقعت لا تُلغى بتنقيصِ رقم.
        if new."attempts" < old."attempts" then
          raise exception 'عدّادُ المحاولات لا ينقص (% ← %)', old."attempts", new."attempts";
        end if;

        -- الشطبُ يُؤرَّخ نفسَه: تاريخٌ ناقصٌ يعني سجلّاً لا يُقرأ منه
        -- متى توقّفنا عن المحاولة.
        if new."status" = 'dead' and new."dead_at" is null then
          new."dead_at" := now();
        end if;

        return new;
      end $$;
    `);
    this.addSql(`
      drop trigger if exists "zadim_guard_notification_send_trg" on "zadim_notification_send";
      create trigger "zadim_guard_notification_send_trg"
        before update on "zadim_notification_send"
        for each row execute function "zadim_guard_notification_send"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_notify_attempt_seq','zadim_notification_attempt','IDX_zadim_notification_attempt_seq',
         'محاولةٌ واحدةٌ برقمٍ واحدٍ لكل رسالة — مُعيدان متزامنان لا يُرسلان نسختين'),
        ('intg_notify_attempt_append','zadim_notification_attempt','zadim_notification_attempt_no_update',
         'دفترُ المحاولات يُلحَق ولا يُمسّ — والتصحيحُ بصفٍّ مقابل'),
        ('intg_notify_terminal','zadim_notification_send','zadim_guard_notification_send_trg',
         'المُسلَّمُ والمكتومُ والمشطوبُ لا تُحيا حالتُهم — والشطبُ يعني الشطب')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`delete from "zadim_integrity_check" where "id" like 'intg_notify_%';`);
    this.addSql(`drop trigger if exists "zadim_guard_notification_send_trg" on "zadim_notification_send";`);
    this.addSql(`drop function if exists "zadim_guard_notification_send"();`);
    this.addSql(`drop table if exists "zadim_notification_attempt" cascade;`);
    this.addSql(`drop function if exists "zadim_seq_notification_attempt"();`);
    this.addSql(`drop function if exists "zadim_count_notification_attempt"();`);
    this.addSql(`
      alter table "zadim_notification_send"
        drop constraint if exists "zadim_notification_send_attempts_check",
        drop column if exists "attempts",
        drop column if exists "last_attempt_at",
        drop column if exists "next_attempt_at",
        drop column if exists "dead_at";
    `);
  }
}
