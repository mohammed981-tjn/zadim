import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة cms — كتلُ الصفحات.
 *
 * والقيدُ الوحيدُ المهمّ هنا: **النوعُ لا يكون فارغاً**. كتلةٌ بلا نوعٍ
 * لا تعرف الواجهةُ كيف تعرضها، فتُتجاهَل صامتةً — ويقف المديرُ أمام
 * صفحةٍ فيها صندوقٌ لا يظهر ولا يفهم لماذا.
 */
export class Migration20260901000080 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_page_block" (
        "id"         text not null,
        "page"       text not null default 'home',
        "type"       text not null,
        "position"   integer not null default 0,
        "is_active"  boolean not null default true,
        "name_ar"    text null,
        "payload"    jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_page_block_pkey" primary key ("id"),
        constraint "zadim_page_block_type_check" check (length("type") > 0),
        constraint "zadim_page_block_position_check" check ("position" >= 0)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_page_block_page_pos"
        on "zadim_page_block" (page, position) where deleted_at is null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "zadim_page_block" cascade;`);
  }
}
