import { MedusaService } from "@medusajs/framework/utils";
import { BulkChange, BulkOperation } from "./models";

export type PlannedChange = {
  entity_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
};

export type ApplyFn = (change: PlannedChange) => Promise<void>;
export type ReadFn = (entity_id: string, field: string) => Promise<string | null>;

/**
 * خدمةُ الدفعات — **التحضيرُ ثم التطبيقُ ثم التراجع**.
 *
 * ── ثلاثُ خطواتٍ لا خطوة ────────────────────────────────────────
 *
 * «حضّر» تقرأ القيمَ الحالية وتحفظها. و«طبّق» تكتب الجديد. والفصلُ
 * بينهما ليس تنظيماً: لو قُرئ القديمُ **بعد** الكتابة لعاد الجديدَ
 * نفسَه، فيصير التراجعُ كتابةَ ما هو مكتوب — **عمليةٌ تنجح ولا تفعل
 * شيئاً**، وهي أخطرُ من فشلٍ صريح لأن أحداً لا يعرف.
 *
 * ── 🔴 والتراجعُ لا يمحو عملَ غيرك ─────────────────────────────
 *
 * بين الدفعة والتراجع قد يكون أحدٌ عدّل صنفاً بيده. وتراجعٌ أعمى يُعيد
 * القيمةَ القديمة **فيمحو تعديلَه بلا أن يعلم**. فالتراجعُ يقرأ الحاليّ
 * أوّلاً: إن كان يساوي ما كتبته الدفعةُ فهو ملكُها وتُعيده، وإن اختلف
 * **يُتخطّى ويُعلَن** — ولا يُكتم.
 */
class BulkModuleService extends MedusaService({ BulkOperation, BulkChange }) {
  /** يقرأ القيمَ الحالية ويحفظها — **قبل** أيّ كتابة. */
  async prepare(input: {
    kind: string;
    entity_type: string;
    requested_by?: string | null;
    note?: string | null;
    changes: PlannedChange[];
  }) {
    const [op] = await this.createBulkOperations([
      {
        kind: input.kind,
        entity_type: input.entity_type,
        requested_by: input.requested_by ?? null,
        note: input.note ?? null,
        item_count: input.changes.length,
        status: "prepared",
      },
    ]);

    // دفعاتٌ من مئات الصفوف: الإدراجُ صفّاً صفّاً يجعل خمسمئةٍ خمسمئةَ
    // ذهابٍ إلى القاعدة. والدفعةُ هنا واحدة.
    await this.createBulkChanges(
      input.changes.map((c) => ({
        bulk_operation_id: op.id,
        entity_id: c.entity_id,
        field: c.field,
        old_value: c.old_value,
        new_value: c.new_value,
        state: "prepared" as const,
      }))
    );

    return op;
  }

  async changesOf(operationId: string, state?: string) {
    const filters: Record<string, unknown> = { bulk_operation_id: operationId };
    if (state) filters.state = state;
    return this.listBulkChanges(filters, { order: { created_at: "ASC" }, take: 100000 });
  }

  /** يكتب الجديد عبر دالّةٍ يمرّرها المُنادي — الوحدةُ لا تعرف المنتجات. */
  async apply(operationId: string, write: ApplyFn) {
    const [op] = await this.listBulkOperations({ id: operationId });
    if (!op) throw new Error("[zadim] لا دفعةَ بهذا المعرّف.");
    if ((op as any).status !== "prepared") {
      throw new Error(`[zadim] الدفعةُ حالُها «${(op as any).status}» ولا تُطبَّق مرّتين.`);
    }

    const changes = await this.changesOf(operationId, "prepared");
    let applied = 0;

    for (const c of changes as any[]) {
      await write({
        entity_id: c.entity_id,
        field: c.field,
        old_value: c.old_value,
        new_value: c.new_value,
      });
      await this.updateBulkChanges({ id: c.id, state: "applied" });
      applied++;
    }

    await this.updateBulkOperations({
      id: operationId,
      status: "applied",
      applied_count: applied,
      applied_at: new Date(),
    });

    return { applied };
  }

  /**
   * يُعيد القيمَ القديمة — **ويتخطّى ما تغيّر بعد الدفعة**.
   *
   * و`read` هي كيف يُقرأ الحاليّ. وبلا القراءة يصير التراجعُ كتابةً
   * عمياء تمحو عملَ من جاء بعدها.
   */
  async revert(operationId: string, read: ReadFn, write: ApplyFn) {
    const [op] = await this.listBulkOperations({ id: operationId });
    if (!op) throw new Error("[zadim] لا دفعةَ بهذا المعرّف.");
    if ((op as any).status !== "applied") {
      throw new Error(`[zadim] لا يُتراجَع عن دفعةٍ حالُها «${(op as any).status}».`);
    }

    const changes = await this.changesOf(operationId, "applied");
    let reverted = 0;
    let skipped = 0;

    for (const c of changes as any[]) {
      const current = await read(c.entity_id, c.field);

      if (current !== c.new_value) {
        await this.updateBulkChanges({
          id: c.id,
          state: "skipped",
          skip_reason: `تغيّر بعد الدفعة (الحاليّ «${current}» والمتوقّع «${c.new_value}»)`,
        });
        skipped++;
        continue;
      }

      await write({
        entity_id: c.entity_id,
        field: c.field,
        old_value: c.new_value,
        new_value: c.old_value,
      });
      await this.updateBulkChanges({ id: c.id, state: "reverted" });
      reverted++;
    }

    await this.updateBulkOperations({
      id: operationId,
      status: "reverted",
      reverted_count: reverted,
      skipped_count: skipped,
      reverted_at: new Date(),
    });

    return { reverted, skipped };
  }

  // سجلُّ ما وقع: يُلحَق ولا يُحذف. ودفعةٌ تُمحى تعني تغييراً على
  // خمسمئة صنفٍ لا أثرَ له.
  deleteBulkOperations = async (): Promise<never> => {
    throw new Error("[zadim] سجلُّ الدفعات يُلحَق ولا يُحذف.");
  };

  deleteBulkChanges = async (): Promise<never> => {
    throw new Error("[zadim] تغييراتُ الدفعة تُلحَق ولا تُحذف.");
  };
}

export default BulkModuleService;
