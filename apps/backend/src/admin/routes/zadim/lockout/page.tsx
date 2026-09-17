import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Switch, Button, Badge, Table } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Policy = {
  id: string;
  actor_type: "user" | "customer";
  window_seconds: number;
  max_failures: number;
  lock_seconds: number;
  enabled: boolean;
};

type Failure = {
  identity_key: string;
  actor_type: string;
  failures: number;
  sources: number;
  last_at: string;
};

type Form = {
  window_seconds: string;
  max_failures: string;
  lock_seconds: string;
  enabled: boolean;
};

const LABEL: Record<string, string> = { user: "الإدارة", customer: "العملاء" };

/**
 * إقفالُ الحساب بعد فشلٍ متكرّر.
 *
 * ── ولماذا الدفترُ في نفس الشاشة ────────────────────────────────
 *
 * لأن ضبطَ الرقم بلا بيانات تخمين. و«٣٤٠ فشلاً على أربعة حساباتٍ من
 * ٢٩٠ مصدراً» هجومٌ موزَّعٌ يستدعي الشدّ؛ و«أربعةٌ على حسابٍ واحدٍ من
 * مصدرٍ واحد» عميلٌ نسي كلمتَه. **وعمودُ «المصادر» هو الذي يفرّق**.
 */
const LockoutPage = () => {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    adminGet<{ policies: Policy[]; recent_failures: Failure[] }>("/admin/access/lockout")
      .then((d) => {
        setPolicies(d.policies ?? []);
        setFailures(d.recent_failures ?? []);
        const next: Record<string, Form> = {};
        for (const p of d.policies ?? []) {
          next[p.actor_type] = {
            window_seconds: String(p.window_seconds),
            max_failures: String(p.max_failures),
            lock_seconds: String(p.lock_seconds),
            enabled: p.enabled,
          };
        }
        setForms(next);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const save = async (actor: "user" | "customer") => {
    const f = forms[actor];
    if (!f) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await adminPost<{ warning_ar: string | null }>("/admin/access/lockout", {
        actor_type: actor,
        window_seconds: Number(f.window_seconds),
        max_failures: Number(f.max_failures),
        lock_seconds: Number(f.lock_seconds),
        enabled: f.enabled,
      });
      setMessage({ ok: true, text: r.warning_ar ?? "حُفظت السياسة." });
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const set = (actor: string, k: keyof Form, v: string | boolean) =>
    setForms((prev) => ({ ...prev, [actor]: { ...prev[actor], [k]: v } as Form }));

  return (
    <Rtl>
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">إقفالُ الحساب بعد فشلٍ متكرّر</Heading>
          <Text className="text-ui-fg-subtle mt-2">
            حدُّ النداءات يحرس <b>العنوان</b>، وهذا يحرس <b>الهويّة</b>. وشبكةٌ
            بعشرة آلاف عنوانٍ تجرّب حساباً واحداً تمرّ تحت حدِّ العنوان كلِّه.
          </Text>
          <Text className="text-ui-fg-subtle mt-2">
            ⚠️ والمقايضةُ صريحة: من عرف بريدَ عميلٍ يقفل حسابَه مؤقّتاً بإفشالِ
            الدخول عمداً. ولذلك الإقفالُ <b>مؤقّت</b>، وجدولُ الفشل أدناه يقول
            لك من أين جاءت المحاولات.
          </Text>
        </div>

        {error && (
          <div className="px-6 py-4">
            <Text className="text-ui-fg-error">{error}</Text>
          </div>
        )}
        {message && (
          <div className="px-6 py-4">
            <Text className={message.ok ? "text-ui-fg-subtle" : "text-ui-fg-error"}>
              {message.text}
            </Text>
          </div>
        )}

        {(policies ?? []).map((p) => {
          const f = forms[p.actor_type];
          if (!f) return null;
          return (
            <div className="px-6 py-4" key={p.id}>
              <div className="flex items-center gap-3">
                <Heading level="h2">{LABEL[p.actor_type] ?? p.actor_type}</Heading>
                <Badge color={p.enabled ? "green" : "grey"}>
                  {p.enabled ? "مفعَّل" : "مُطفأ"}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4 mt-3">
                <div>
                  <Label>نافذةُ العدّ (ثانية)</Label>
                  <Input
                    value={f.window_seconds}
                    onChange={(e) => set(p.actor_type, "window_seconds", e.target.value)}
                  />
                </div>
                <div>
                  <Label>سقفُ الفشل</Label>
                  <Input
                    value={f.max_failures}
                    onChange={(e) => set(p.actor_type, "max_failures", e.target.value)}
                  />
                </div>
                <div>
                  <Label>مدّةُ الإقفال (ثانية)</Label>
                  <Input
                    value={f.lock_seconds}
                    onChange={(e) => set(p.actor_type, "lock_seconds", e.target.value)}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <Switch
                    checked={f.enabled}
                    onCheckedChange={(v) => set(p.actor_type, "enabled", v)}
                  />
                  <Label>مفعَّل</Label>
                </div>
              </div>
              <Button className="mt-3" disabled={busy} onClick={() => save(p.actor_type)}>
                حفظ
              </Button>
            </div>
          );
        })}

        <div className="px-6 py-4">
          <Heading level="h2">الفشلُ في آخر ٢٤ ساعة</Heading>
          <Text className="text-ui-fg-subtle mt-1">
            <b>المصادر</b> هو العمودُ الفارق: مصدرٌ واحدٌ عميلٌ نسي كلمتَه،
            ومئاتٌ هجومٌ موزَّع.
          </Text>
          {failures.length === 0 ? (
            <Text className="text-ui-fg-subtle mt-3">لا فشلَ مسجَّلاً.</Text>
          ) : (
            <Table className="mt-3">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>الهويّة</Table.HeaderCell>
                  <Table.HeaderCell>النوع</Table.HeaderCell>
                  <Table.HeaderCell>الفشل</Table.HeaderCell>
                  <Table.HeaderCell>المصادر</Table.HeaderCell>
                  <Table.HeaderCell>آخرُ محاولة</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {failures.map((r) => (
                  <Table.Row key={`${r.actor_type}:${r.identity_key}`}>
                    <Table.Cell>{r.identity_key}</Table.Cell>
                    <Table.Cell>{LABEL[r.actor_type] ?? r.actor_type}</Table.Cell>
                    <Table.Cell>{r.failures}</Table.Cell>
                    <Table.Cell>
                      <Badge color={r.sources > 5 ? "red" : "grey"}>{r.sources}</Badge>
                    </Table.Cell>
                    <Table.Cell>{new Date(r.last_at).toLocaleString("ar-SA")}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </div>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "إقفالُ الحسابات" });

export default LockoutPage;
