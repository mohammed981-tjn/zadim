import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge, Button, Input, Label, Switch } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPatch } from "../../../lib/rtl";

type Troubled = {
  id: string;
  event_id: string;
  channel: string;
  recipient_masked: string;
  status: string;
  attempts: number;
  dead_at: string | null;
  next_attempt_at: string | null;
  last_provider: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
};

type Log = {
  window_days: number;
  totals: { all: number; queued: number; sent: number; failed: number; dead: number; suppressed: number };
  troubled: Troubled[];
};

type PolicyResp = {
  policy: { id: string; max_attempts: number; retry_after_seconds: number; is_enabled: boolean; note: string | null } | null;
  effective: { max_attempts: number; retry_after_seconds: number; is_enabled: boolean };
};

/**
 * الإشعارات — السجلُّ والسياسة.
 *
 * ── ولماذا `queued` هنا ليست «نجاحاً» ────────────────────────────
 *
 * لا مزوّدَ رسائلَ حقيقيٌّ بعد (حاجزٌ على المالك). والمزوّدُ الحاليُّ
 * يكتب في سجلٍّ ويردّ `queued` **دائماً**. فرقمُ `queued` الكبير ليس
 * طابوراً يتحرّك بل **رسائلَ لم تُرسل قطّ**، وقراءتُه نجاحاً هو أخطرُ
 * ما في هذه الشاشة. فيُقال صراحةً في أعلاها.
 *
 * ── و`is_enabled = false` ليس زرَّ تعطيل ─────────────────────────
 *
 * هو صمّامُ يومِ سقوطِ المزوّد: يوقف الطرقَ على بابه حتى يتعافى، بدل
 * الاختيار بين إغراقِ مزوّدٍ ساقطٍ وإيقافِ الإشعارات كلِّها.
 */
const NotificationsPage = () => {
  const [log, setLog] = useState<Log | null>(null);
  const [pol, setPol] = useState<PolicyResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [maxAttempts, setMaxAttempts] = useState("");
  const [retryAfter, setRetryAfter] = useState("");
  const [enabled, setEnabled] = useState(true);

  const load = () => {
    adminGet<Log>("/admin/notifications/log?days=7&limit=50")
      .then(setLog)
      .catch((e) => setError(String(e.message)));
    adminGet<PolicyResp>("/admin/notifications/policy")
      .then((d) => {
        setPol(d);
        setMaxAttempts(String(d.effective.max_attempts));
        setRetryAfter(String(d.effective.retry_after_seconds));
        setEnabled(d.effective.is_enabled);
      })
      .catch(() => setPol(null));
  };

  useEffect(load, []);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPatch("/admin/notifications/policy", {
        max_attempts: Number(maxAttempts),
        retry_after_seconds: Number(retryAfter),
        is_enabled: enabled,
      });
      setMessage({ ok: true, text: "حُفظت السياسة." });
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">الإشعارات</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}). تحتاج صلاحية «قراءة التدقيق».</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">الإشعارات</Heading>

        <Text className="text-ui-fg-error" style={{ marginTop: 8 }}>
          ⚠️ لا مزوّدَ رسائلَ حقيقيٌّ بعد — و«في الطابور» تعني **لم تُرسل**،
          لا «في الطريق». الرقمُ يصير ذا معنًى يومَ يُضاف المزوّد.
        </Text>

        {message && (
          <Text className={message.ok ? "text-ui-fg-interactive" : "text-ui-fg-error"} style={{ marginTop: 12 }}>
            {message.text}
          </Text>
        )}

        {log && (
          <>
            <Heading level="h2" style={{ marginTop: 24 }}>آخرُ {log.window_days} أيام</Heading>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <Badge>الكلّ: {log.totals.all}</Badge>
              <Badge>في الطابور: {log.totals.queued}</Badge>
              <Badge color="green">أُرسلت: {log.totals.sent}</Badge>
              <Badge color="orange">فشلت: {log.totals.failed}</Badge>
              <Badge color="red">ميّتة: {log.totals.dead}</Badge>
              <Badge>مكبوتة: {log.totals.suppressed}</Badge>
            </div>

            <Heading level="h2" style={{ marginTop: 24 }}>المتعثّرةُ والميّتة</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              العنوانُ مُقنَّعٌ عمداً — سجلُّ تشخيصٍ لا دفترُ عناوين.
              و«ميّتة» تعني: لن تُعاد أبداً.
            </Text>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>القناة</Table.HeaderCell>
                  <Table.HeaderCell>المستقبِل</Table.HeaderCell>
                  <Table.HeaderCell>الحالة</Table.HeaderCell>
                  <Table.HeaderCell>المحاولات</Table.HeaderCell>
                  <Table.HeaderCell>آخرُ خطأ</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {log.troubled.map((t) => (
                  <Table.Row key={t.id}>
                    <Table.Cell>{t.channel}</Table.Cell>
                    <Table.Cell>{t.recipient_masked}</Table.Cell>
                    <Table.Cell>
                      <Badge color={t.status === "dead" ? "red" : "orange"}>{t.status}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {t.attempts}
                      {t.next_attempt_at && (
                        <Text size="small" className="text-ui-fg-subtle">
                          التالية {new Date(t.next_attempt_at).toLocaleString("ar-SA")}
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small" style={{ maxWidth: 320, wordBreak: "break-word" }}>
                        {t.last_error ?? "—"}
                      </Text>
                      {t.last_provider && (
                        <Text size="small" className="text-ui-fg-subtle">{t.last_provider}</Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            {log.troubled.length === 0 && (
              <Text className="text-ui-fg-subtle" style={{ marginTop: 8 }}>لا رسالةَ متعثّرةٌ في النافذة.</Text>
            )}
          </>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>سياسةُ إعادة المحاولة</Heading>
        {pol && pol.policy === null && (
          <Text size="small" className="text-ui-fg-subtle">
            لا صفَّ سياسةٍ محفوظٌ بعد — والقيمُ المعروضةُ هي **السارية**
            افتراضاً، وحفظُها ينشئ الصفّ.
          </Text>
        )}
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 12 }}>
          <div style={{ width: 160 }}>
            <Label size="small">أقصى محاولات</Label>
            <Input value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
          </div>
          <div style={{ width: 200 }}>
            <Label size="small">المهلةُ بين المحاولات (ثانية)</Label>
            <Input value={retryAfter} onChange={(e) => setRetryAfter(e.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch checked={enabled} onCheckedChange={setEnabled} id="notify-enabled" />
            <Label htmlFor="notify-enabled">التصريفُ يعمل</Label>
          </div>
          <Button onClick={save} disabled={busy}>حفظ</Button>
        </div>
        <Text size="small" className="text-ui-fg-subtle" style={{ marginTop: 8 }}>
          إطفاءُ التصريف صمّامٌ ليومِ سقوط المزوّد لا زرَّ تعطيل — الرسائلُ
          تنتظر ولا تُفقد.
        </Text>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الإشعارات" });

export default NotificationsPage;
