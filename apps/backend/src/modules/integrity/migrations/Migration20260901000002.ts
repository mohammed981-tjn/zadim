import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * الحارسُ الحقيقي: مُطلِقٌ يمنع البيعَ الزائد عبر جدولين.
 *
 * ── لماذا لم يكفِ القيدُ السابق ──────────────────────────────────
 *
 * `Migration20260901000001` وضع `reserved_quantity <= stocked_quantity`
 * على `inventory_level`. وقِيس بعده فلم يمنع شيئاً:
 *
 * ```
 * نجحت: 94 · stocked=10 reserved=9 available=1 · صفوفُ الحجز: 94
 * ```
 *
 * **والسبب أن القيد يحرس عدّاداً، والعدّادُ ليس الحقيقة.** الحقيقةُ
 * أربعةٌ وتسعون صفَّ حجزٍ في `reservation_item`، و`reserved_quantity`
 * حقلٌ مشتقٌّ يُحدَّث بقراءةٍ ثم كتابة — فيفسده التزاحمُ ويقول «٩».
 * فالقيدُ يقارن عشرةً بتسعة ويمرّ، والمتجرُ يعد ٩٤ عميلاً ببضاعةٍ
 * لعشرة.
 *
 * والثابتُ الحقيقي **يعبر جدولين**:
 *
 *     SUM(reservation_item.quantity) ≤ inventory_level.stocked_quantity
 *
 * و`CHECK` لا يرى إلا صفَّه. فالمُطلِقُ هو الأداة الوحيدة التي تراهما.
 *
 * ── وكيف يمنع التزاحم ────────────────────────────────────────────
 *
 * `SELECT … FOR UPDATE` على صفّ المستوى **يُسلسل** المتزاحمين: الثاني
 * ينتظر حتى تُنهي معاملةُ الأول، فيقرأ مجموعاً محدَّثاً لا قديماً. وهذا
 * ما ينقص القراءةَ-ثم-الكتابةَ في التطبيق.
 *
 * ── وما لا يفعله ────────────────────────────────────────────────
 *
 * لا يُغني عن قفل Medusa ولا عن مزوّدِ قفلٍ موزَّع في الإنتاج: القفلُ
 * يمنع العملَ الضائع (تسعون محاولةً تصل القاعدة لتُرفض)، وهذا يمنع
 * **الخطأ**. الأول أداءٌ والثاني صحّة.
 */
export class Migration20260901000002 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create or replace function "zadim_guard_reservation"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_stocked numeric;
        v_reserved numeric;
      begin
        -- يقفل صفَّ المستوى: المتزاحمُ الثاني ينتظر هنا فيقرأ مجموعاً
        -- محدَّثاً. وبلا هذا القفل تقرأ المئةُ نفسَ الرقم القديم.
        select "stocked_quantity" into v_stocked
          from "inventory_level"
         where "inventory_item_id" = new."inventory_item_id"
           and "location_id" = new."location_id"
           and "deleted_at" is null
         for update;

        -- لا مستوى لهذه المادة في هذا الموقع: حجزٌ على العدم. ويُرفض
        -- صراحةً — والسماحُ به يُنتج حجوزاً يتيمةً لا يراها أيُّ تقرير.
        if v_stocked is null then
          raise exception
            'zadim: حجزٌ على موقعٍ بلا مستوى مخزون (item=%, location=%)',
            new."inventory_item_id", new."location_id"
            using errcode = 'check_violation';
        end if;

        -- مجموعُ الحجوزات الحيّة **بما فيها الصفُّ الجديد**.
        select coalesce(sum("quantity"), 0) into v_reserved
          from "reservation_item"
         where "inventory_item_id" = new."inventory_item_id"
           and "location_id" = new."location_id"
           and "deleted_at" is null
           and "id" <> new."id";

        v_reserved := v_reserved + new."quantity";

        if v_reserved > v_stocked then
          raise exception
            'zadim: بيعٌ زائد — المطلوب % والموجود % (item=%)',
            v_reserved, v_stocked, new."inventory_item_id"
            using errcode = 'check_violation';
        end if;

        -- والعدّادُ يُصحَّح من المجموع لا يُزاد: مشتقٌّ صحيحٌ دائماً بدل
        -- حقلٍ يفسده التزاحم.
        update "inventory_level"
           set "reserved_quantity" = v_reserved,
               "raw_reserved_quantity" = jsonb_build_object('value', v_reserved::text, 'precision', 20)
         where "inventory_item_id" = new."inventory_item_id"
           and "location_id" = new."location_id"
           and "deleted_at" is null;

        return new;
      end;
      $$;
    `);

    this.addSql(`drop trigger if exists "zadim_guard_reservation_trg" on "reservation_item";`);
    this.addSql(`
      create trigger "zadim_guard_reservation_trg"
        before insert or update of "quantity", "location_id", "inventory_item_id"
        on "reservation_item"
        for each row
        execute function "zadim_guard_reservation"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_trg','reservation_item','zadim_guard_reservation_trg',
              'مجموعُ الحجوزات لا يتجاوز الموجود — ثابتٌ يعبر جدولين لا يعبّر عنه CHECK')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_reservation_trg" on "reservation_item";`);
    this.addSql(`drop function if exists "zadim_guard_reservation"();`);
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_trg';`);
  }
}
