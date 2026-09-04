import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * سجلُّ التسليم — **«كم أُرسل، وكم فشل، ولماذا»**.
 *
 * ── ولماذا مسارٌ أصلاً ──────────────────────────────────────────
 *
 * لأن دفتراً يُكتب ولا يُقرأ ليس دفتراً. والرسالةُ المشطوبة (`dead`)
 * عميلٌ لم يصله ما وُعد به، ولا شيءَ بعد صفِّها يذكّر بها — فإن لم يرها
 * المديرُ فالشطبُ صمتٌ مُهندَس.
 *
 * ── والعنوانُ يُقنَّع، والنصُّ لا يُعاد ─────────────────────────
 *
 * 🔴 وهذا ليس تشدّداً: المطلوبُ من هذه الشاشة **صحّةُ القناة** لا
 * محتوى المراسلات. ومسارٌ يُعيد بريدَ كلّ عميلٍ ونصَّ كلّ رسالةٍ لمن
 * يملك `audit.read` يصير **مُصدِّرَ قوائمَ بريدية** بابُه مفتوح — ولا
 * حاجةَ إليه لتشخيص عطل: الحالةُ والمزوّدُ ونصُّ الخطأ تكفي.
 *
 * والصلاحيةُ `audit.read` لا `settings.read`: هذا دفترُ وقائعَ عن
 * عملاءَ بأعيانهم، ومن لا يُؤتمن على سجلّ التدقيق لا يُؤتمن عليه.
 */

/** `ahmed@zadim.co` ⇒ `a•••@zadim.co` — يكفي للتشخيص ولا يُصدَّر. */
function mask(recipient: string): string {
  const value = String(recipient ?? "");
  const at = value.indexOf("@");
  if (at > 0) return `${value.slice(0, 1)}•••${value.slice(at)}`;
  // جوّالٌ أو معرّفٌ آخر: تُترك أربعةُ أرقامٍ أخيرةٍ وحدَها.
  return value.length > 4 ? `•••${value.slice(-4)}` : "•••";
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const q = req.query as Record<string, string | undefined>;

  const days = Math.min(Math.max(Number(q.days ?? 7) || 7, 1), 90);
  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);

  // المجاميعُ بالحالة — والمقامُ مذكورٌ دائماً: «١٢ فشلاً» بلا «من كم»
  // رقمٌ لا يُقرَأ منه شيء.
  const totals = await pg.raw(
    `select "status", count(*)::int as n
       from "zadim_notification_send"
      where "created_at" >= now() - (? * interval '1 day')
      group by "status"`,
    [days]
  );

  const by: Record<string, number> = {};
  for (const row of totals?.rows ?? []) by[String(row.status)] = Number(row.n);
  const total = Object.values(by).reduce((a, b) => a + b, 0);

  // ⚠️ والفاشلُ يُعرض بآخر خطإٍ **من الدفتر** لا من حقل الصفّ: الحقلُ
  // يُكتب فوقه، والدفترُ يحفظ سلسلةَ الأسباب — وهي الفرقُ بين «عنوانٌ
  // مرفوض» و«المزوّدُ سقط عشرَ دقائق».
  const troubled = await pg.raw(
    `select s."id", s."event_id", s."channel", s."recipient", s."status",
            s."attempts", s."dead_at", s."next_attempt_at",
            a."status" as last_attempt_status, a."provider" as last_provider,
            a."error" as last_error, a."created_at" as last_attempt_at
       from "zadim_notification_send" s
       left join lateral (
         select "status", "provider", "error", "created_at"
           from "zadim_notification_attempt"
          where "send_id" = s."id"
          order by "attempt_no" desc
          limit 1
       ) a on true
      where s."status" in ('failed','dead')
        and s."created_at" >= now() - (? * interval '1 day')
      order by s."updated_at" desc
      limit ?`,
    [days, limit]
  );

  res.json({
    window_days: days,
    totals: {
      all: total,
      queued: by.queued ?? 0,
      sent: by.sent ?? 0,
      failed: by.failed ?? 0,
      dead: by.dead ?? 0,
      suppressed: by.suppressed ?? 0,
    },
    troubled: (troubled?.rows ?? []).map((r: any) => ({
      id: r.id,
      event_id: r.event_id,
      channel: r.channel,
      recipient_masked: mask(r.recipient),
      status: r.status,
      attempts: Number(r.attempts),
      dead_at: r.dead_at,
      next_attempt_at: r.next_attempt_at,
      last_attempt_status: r.last_attempt_status,
      last_provider: r.last_provider,
      last_error: r.last_error,
      last_attempt_at: r.last_attempt_at,
    })),
  });
}
