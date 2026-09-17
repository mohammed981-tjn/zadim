import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * إقفالُ الحساب بعد فشلٍ متكرّر: دفترٌ وسياسة.
 *
 * ── 🔴 ولماذا الدفترُ محميٌّ بقواعدِ القاعدة لا بأدبِ الكود ───────
 *
 * لأن قيمةَ الدفتر كلَّها في أنه **لا يُمسّ**: من استطاع حذفَ صفوف
 * الفشل استطاع أن يجرّب بلا حدّ — فيصير الحارسُ زينةً بينما يبدو
 * عاملاً. و`DO INSTEAD NOTHING` يجعل الحذفَ والتعديلَ **يمرّان بلا
 * خطأٍ ولا أثر**، فلا يكشفهما إلا القياس (وهو ما تفعله البوّابة).
 *
 * والكنسُ الدوريُّ ليس استثناءً منه: يقع بـ`TRUNCATE`؟ لا — القاعدةُ
 * تمنعه أيضاً. فالكنسُ يُعطّل القاعدةَ ويُعيدها كما يفعل تنظيفُ
 * البوّابات، وهو فعلٌ إداريٌّ صريحٌ لا يقع في مسار طلب.
 */
export class Migration20260917000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_login_failure" (
        "id" text not null,
        "identity_key" text not null,
        "actor_type" text not null,
        "ip" text,
        "user_agent" text,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz,
        constraint "zadim_login_failure_pkey" primary key ("id"),
        constraint "zadim_login_failure_actor_check"
          check ("actor_type" in ('user', 'customer'))
      );
    `);

    // الفهرسُ على (الهويّة · النوع · الوقت): كلُّ فحصٍ يسأل «كم فشلاً
    // لهذه الهويّة منذ لحظةٍ ما» — وبلا فهرسٍ يصير الحارسُ **هو**
    // طريقَ الإسقاط، إذ يمسح دفتراً ينمو مع كل هجوم.
    this.addSql(`
      create index if not exists "IDX_zadim_login_failure_lookup"
        on "zadim_login_failure" ("identity_key", "actor_type", "created_at" desc);
    `);

    this.addSql(`
      create rule "zadim_login_failure_no_update" as
        on update to "zadim_login_failure" do instead nothing;
    `);
    this.addSql(`
      create rule "zadim_login_failure_no_delete" as
        on delete to "zadim_login_failure" do instead nothing;
    `);

    this.addSql(`
      create table if not exists "zadim_lockout_policy" (
        "id" text not null,
        "actor_type" text not null,
        "window_seconds" integer not null,
        "max_failures" integer not null,
        "lock_seconds" integer not null,
        "enabled" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz,
        constraint "zadim_lockout_policy_pkey" primary key ("id"),
        constraint "zadim_lockout_policy_actor_check"
          check ("actor_type" in ('user', 'customer')),
        -- أصفارٌ لا معنى لها: نافذةُ صفرٍ لا تعدّ شيئاً، وسقفُ صفرٍ
        -- يقفل كلَّ حسابٍ عند أوّل محاولة. والإطفاءُ بـ«enabled».
        constraint "zadim_lockout_policy_window_check" check ("window_seconds" > 0),
        constraint "zadim_lockout_policy_max_check" check ("max_failures" > 0),
        constraint "zadim_lockout_policy_lock_check" check ("lock_seconds" > 0)
      );
    `);

    // صفٌّ واحدٌ لكلّ نوعِ فاعل: صفّان متعارضان على نفس النوع خطأٌ
    // إداريٌّ لا يُعرف أيُّهما حَكَم.
    this.addSql(`
      create unique index if not exists "IDX_zadim_lockout_policy_actor"
        on "zadim_lockout_policy" ("actor_type")
        where "deleted_at" is null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop rule if exists "zadim_login_failure_no_delete" on "zadim_login_failure";`);
    this.addSql(`drop rule if exists "zadim_login_failure_no_update" on "zadim_login_failure";`);
    this.addSql(`drop table if exists "zadim_login_failure" cascade;`);
    this.addSql(`drop table if exists "zadim_lockout_policy" cascade;`);
  }
}
