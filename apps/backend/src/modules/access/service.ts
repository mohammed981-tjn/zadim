import { MedusaService } from "@medusajs/framework/utils";
import {
  Permission,
  Role,
  RoleLimit,
  UserRole,
  AuditLog,
  RateLimitPolicy,
  RateLimitCounter,
} from "./models";

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; code: "INSUFFICIENT_PERMISSION" | "LIMIT_EXCEEDED"; reason_ar: string };

export type AccessCheck = {
  user_id: string;
  permission: string;
  /** المبلغ بالهللات — يُفحص ضد سقف الدور حين يكون للصلاحية سقف */
  amount?: bigint | number | string;
  /** العدد — مثال: كم صنفاً في دفعةٍ واحدة */
  count?: number;
  vendor_id?: string | null;
};

export type AuditEntry = {
  actor_id?: string | null;
  actor_label: string;
  action: string;
  entity: string;
  entity_id: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  ip?: string | null;
  user_agent?: string | null;
};

/**
 * خدمة الصلاحيات وسجلّ التدقيق.
 *
 * `MedusaService` يولّد CRUD لكل نموذج. ونضيف فوقه ما يحمل قواعد
 * العمل: `can()` و`record()`.
 */
class AccessModuleService extends MedusaService({
  Permission,
  Role,
  RoleLimit,
  UserRole,
  AuditLog,
  // تحديدُ المعدّل يسكن هنا لا في وحدةٍ جديدة: هو تحكّمُ وصولٍ
  // بالتكرار كما أن الأدوارُ تحكّمُ وصولٍ بالهوية — وجمعُهما يُبقي
  // سطحَ الأمن في مكانٍ واحدٍ يُقرأ مرّة.
  RateLimitPolicy,
  RateLimitCounter,
}) {
  /**
   * هل يملك المستخدم هذه الصلاحية — وضمن حدّه؟
   *
   * وترتيبُ الفحص مقصود: **الصلاحية أولاً ثم الحدّ**. فمن لا يملك
   * `orders.refund` أصلاً يُردّ بـINSUFFICIENT_PERMISSION، ولا يُقال
   * له LIMIT_EXCEEDED فيستنتج أن عنده الصلاحية بسقفٍ أدنى — تسريبُ
   * معلومةٍ لا داعيَ له.
   */
  async can(check: AccessCheck): Promise<AccessDecision> {
    const assignments = await this.listUserRoles(
      { user_id: check.user_id },
      { relations: ["role", "role.permissions", "role.limits"] }
    );

    if (!assignments.length) {
      return {
        allowed: false,
        code: "INSUFFICIENT_PERMISSION",
        reason_ar: "لا دورَ مُسنداً لهذا المستخدم",
      };
    }

    // دورٌ محصورٌ ببائع لا يُجيز عملاً على بائعٍ آخر (ADR-004).
    const scoped = assignments.filter(
      (a: any) => a.vendor_id == null || a.vendor_id === check.vendor_id
    );

    const holders = scoped.filter((a: any) =>
      (a.role?.permissions ?? []).some((p: any) => p.slug === check.permission)
    );

    if (!holders.length) {
      return {
        allowed: false,
        code: "INSUFFICIENT_PERMISSION",
        reason_ar: `الصلاحية «${check.permission}» غير ممنوحةٍ لأدوار هذا المستخدم`,
      };
    }

    // حين يحمل المستخدم أكثرَ من دور، **الأوسعُ يفوز**: دورٌ بلا سقفٍ
    // على هذه الصلاحية يُجيز بلا حدّ. وهذا هو المتوقّع — من مُنح دور
    // المالية بجانب الدعم يسترد بصلاحية المالية.
    let bestAmount: bigint | null = null;   // null = بلا سقف
    let bestCount: number | null = null;
    let needsSecond = true;
    let anyUnlimitedAmount = false;
    let anyUnlimitedCount = false;

    for (const a of holders) {
      const limit = (a.role?.limits ?? []).find(
        (l: any) => l.permission_slug === check.permission
      );

      if (!limit) {
        anyUnlimitedAmount = true;
        anyUnlimitedCount = true;
        needsSecond = false;
        continue;
      }

      if (limit.max_amount == null) anyUnlimitedAmount = true;
      else {
        const v = toHalalas(limit.max_amount);
        bestAmount = bestAmount == null || v > bestAmount ? v : bestAmount;
      }

      if (limit.max_count == null) anyUnlimitedCount = true;
      else bestCount = bestCount == null || limit.max_count > bestCount ? limit.max_count : bestCount;

      if (!limit.requires_second_approval) needsSecond = false;
    }

    if (check.amount != null && !anyUnlimitedAmount && bestAmount != null) {
      const requested = toHalalas(check.amount);
      if (requested > bestAmount) {
        return {
          allowed: false,
          code: "LIMIT_EXCEEDED",
          reason_ar: `المبلغ يتجاوز سقف الدور (${bestAmount} هللة)`,
        };
      }
    }

    if (check.count != null && !anyUnlimitedCount && bestCount != null) {
      if (check.count > bestCount) {
        return {
          allowed: false,
          code: "LIMIT_EXCEEDED",
          reason_ar: `العدد يتجاوز حدّ الدور (${bestCount})`,
        };
      }
    }

    if (needsSecond) {
      return {
        allowed: false,
        code: "LIMIT_EXCEEDED",
        reason_ar: "هذه العملية تحتاج موافقةً ثانية",
      };
    }

    return { allowed: true };
  }

  /** قيدٌ في سجلّ التدقيق. المسار الوحيد للكتابة فيه. */
  async record(entry: AuditEntry) {
    return await this.createAuditLogs({
      actor_id: entry.actor_id ?? null,
      actor_label: entry.actor_label,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entity_id,
      old_value: entry.old_value ?? null,
      new_value: entry.new_value ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.user_agent ?? null,
    });
  }

  // ── سجلُّ التدقيق يُلحَق ولا يُعدَّل ولا يُحذف ────────────────────
  // القاعدة تمنعهما فعلياً (RULE … DO INSTEAD NOTHING في الهجرة)، لكن
  // القاعدةَ هناك **صامتة**: النداءُ يمرّ ولا يفعل شيئاً. وهذه ترمي
  // صراحةً — فالمبرمجُ الذي يكتب `updateAuditLogs` يعرف خطأه في
  // الاختبار لا في مراجعةٍ بعد سنة.
  //
  // وتُكتب حقولاً لا دوالَّ لأن الصنف المولَّد يعرّفها حقولاً — ودالّةٌ
  // فوق حقلٍ لا تُغطّيه في TypeScript ولا في وقت التشغيل.
  updateAuditLogs = async (): Promise<never> => {
    throw new Error("[zadim] سجلّ التدقيق يُلحَق ولا يُعدَّل.");
  };

  deleteAuditLogs = async (): Promise<never> => {
    throw new Error("[zadim] سجلّ التدقيق يُلحَق ولا يُحذف.");
  };
}

/** الهللاتُ صحيحةٌ دائماً (ADR-008): لا FLOAT ولا تقريب. */
function toHalalas(value: bigint | number | string | { toString(): string }): bigint {
  if (typeof value === "bigint") return value;
  const raw = typeof value === "number" ? String(value) : value.toString();
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`[zadim] مبلغٌ غيرُ صحيح بالهللات: «${raw}»`);
  }
  return BigInt(raw);
}

export default AccessModuleService;
