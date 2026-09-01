import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * جدولُ الترجمة (المرحلة ١١ب). بخطّ اليد — المولّد يسقط على الوحدات
 * المحلية في 2.19.0 (ADR-001).
 */
export class Migration20260901000110 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_translation" (
        "id"          text not null,
        "entity_type" text not null,
        "entity_id"   text not null,
        "field"       text not null,
        "locale"      text not null,
        "value"       text not null,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "zadim_translation_pkey" primary key ("id"),

        -- 🔴 قائمةُ ما يُترجَم — محصورةً في القاعدة لا في المسار.
        --
        -- \`handle\` رابطٌ، و\`status\` حالةُ نشر، و\`sku\` رمزُ مستودع:
        -- كلُّها نصوصٌ في نظر القاعدة، وكلُّها تُكسر بالترجمة. وقيدٌ
        -- هنا يحرس الجدولَ من كل بابٍ يكتب فيه — لا من الباب الذي
        -- كتبناه وحدَه.
        --
        -- وتوسيعُها هجرةٌ مقصودة: إضافةُ حقلٍ للترجمة قرارٌ يُراجَع، لا
        -- سطرٌ يمرّ في مراجعةِ كود.
        constraint "zadim_translation_field_check" check (
          ("entity_type", "field") in (
            ('product',            'title'),
            ('product',            'subtitle'),
            ('product',            'description'),
            ('product',            'material'),
            ('product_variant',    'title'),
            ('product_category',   'name'),
            ('product_category',   'description'),
            ('product_collection', 'title'),

            -- وكتلُ الرئيسية: نصُّها داخل \`payload\` (jsonb) لا في عمود،
            -- فيُسمّى الحقلُ بمساره. وبدونها تبقى \`/en\` صفحةً
            -- إنجليزيةً عنوانُها الأوّلُ عربيّ — وهي أوّلُ ما يراه
            -- الزائر، فلا معنى لترجمةِ ما تحتها.
            ('cms_block',          'payload.title'),
            ('cms_block',          'payload.subtitle'),
            ('cms_block',          'payload.body'),
            ('cms_block',          'payload.cta_label')
          )
        ),

        -- رمزُ لغةٍ لا قائمةُ لغات: القائمةُ تسكن الواجهة
        -- (\`LOCALES\` في \`lib/i18n\`)، والقاعدةُ تمنع الشكلَ الفاسد
        -- وحدَه. فلغةٌ ثالثةٌ لا تحتاج هجرة، و\`locale = 'english'\`
        -- لا يمرّ ليصير صفّاً لا يقرؤه أحدٌ أبداً.
        constraint "zadim_translation_locale_check"
          check ("locale" ~ '^[a-z]{2}$'),

        -- والفارغةُ تمحو ولا تحلّ: صفحةٌ بلا عنوان أسوأُ من صفحةٍ
        -- بعنوانٍ عربيّ.
        constraint "zadim_translation_value_check"
          check (btrim("value") <> '')
      );
    `);

    this.addSql(`
      create unique index if not exists "IDX_zadim_translation_unique"
        on "zadim_translation" (entity_type, entity_id, field, locale)
        where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_translation_read"
        on "zadim_translation" (locale, entity_id)
        where deleted_at is null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "zadim_translation" cascade;`);
  }
}
