import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge, Button, Input, Label, Select, Switch } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost, adminPatch, adminDelete, riyals } from "../../../lib/rtl";

type Limit = {
  permission_slug: string;
  max_amount: string | null;
  max_count: number | null;
  requires_second_approval: boolean;
};

type Role = {
  id: string;
  slug: string;
  name_ar: string;
  is_system: boolean;
  permissions: string[];
  limits: Limit[];
};

type Assignment = { id: string; user_id: string; role_id: string; role?: { name_ar: string; slug: string } };
type User = { id: string; email: string; first_name?: string | null; last_name?: string | null };

/**
 * الأدوارُ والإسناد.
 *
 * ── لماذا شاشةٌ واحدةٌ لا اثنتان ───────────────────────────────────
 *
 * لأن السؤالَ واحد: «من يستطيع ماذا؟». وجوابُه نصفُه في الأدوار
 * (ما الذي يخوّله هذا الدور) ونصفُه في الإسناد (من يحمله). وشاشتان
 * تجعلان المديرَ يفتح واحدةً ليقرأ الدورَ ثم أخرى ليسنده، فينسخ
 * معرّفاً بين نافذتين.
 *
 * ── وما لا تفعله هذه الشاشةُ عمداً ────────────────────────────────
 *
 * **لا تمنح دوراً صلاحيةً جديدة.** الأدوارُ أدوارُ نظام، ومنحُ صلاحيةٍ
 * تغييرٌ في المعمار يستحقّ مراجعةَ كودٍ لا نداءً ليلياً من لوحة
 * (المسارُ الخلفيُّ يمنعه أصلاً). والقابلُ للضبط هنا **الحدُّ**: رقمٌ
 * تشغيليٌّ يرفعه المديرُ حين يثق ويخفضه حين يشكّ (بند ٤٨).
 */
const RolesPage = () => {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // تحريرُ حدٍّ واحد — لا نموذجَ عامٌّ يكتب كلَّ الحدود دفعةً، فخطأٌ
  // في حقلٍ واحدٍ يعيد كتابةَ الباقي بقيمِ الشاشة لا بقيمِ القاعدة.
  const [editRole, setEditRole] = useState<string>("");
  const [permSlug, setPermSlug] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [maxCount, setMaxCount] = useState("");
  const [second, setSecond] = useState(false);

  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState("");

  const load = () => {
    adminGet<{ roles: Role[] }>("/admin/access/roles")
      .then((d) => setRoles(d.roles))
      .catch((e) => setError(String(e.message)));
    adminGet<{ assignments: Assignment[] }>("/admin/access/assignments")
      .then((d) => setAssignments(d.assignments))
      .catch(() => setAssignments([]));
    // قائمةُ المستخدمين اختياريّة: من لا يملك `users.manage` يرى الشاشةَ
    // بلا مُنتقٍ ويكتب المعرّفَ يدوياً، بدل أن تسقط الشاشةُ كلُّها.
    adminGet<{ users: User[] }>("/admin/users?limit=200")
      .then((d) => setUsers(d.users ?? []))
      .catch(() => setUsers([]));
  };

  useEffect(load, []);

  const saveLimit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const role = (roles ?? []).find((r) => r.id === editRole);
      // الحدودُ تُرسل كاملةً لأن المسار يستبدلها — فتُبنى من القاعدة
      // ويُستبدل المعنيُّ وحدَه.
      const kept = (role?.limits ?? []).filter((l) => l.permission_slug !== permSlug);
      const limits = [
        ...kept,
        {
          permission_slug: permSlug,
          max_amount: maxAmount === "" ? null : String(Math.round(Number(maxAmount) * 100)),
          max_count: maxCount === "" ? null : Number(maxCount),
          requires_second_approval: second,
        },
      ];
      await adminPatch(`/admin/access/roles/${editRole}`, { limits });
      setMessage({ ok: true, text: `حُدّث حدُّ «${permSlug}».` });
      setPermSlug("");
      setMaxAmount("");
      setMaxCount("");
      setSecond(false);
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  const assign = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/access/assignments", { user_id: newUser, role_id: newRole });
      setMessage({ ok: true, text: "أُسنِد الدور." });
      setNewUser("");
      setNewRole("");
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  const revoke = async (a: Assignment) => {
    setBusy(true);
    setMessage(null);
    try {
      await adminDelete(`/admin/access/assignments/${a.id}`);
      setMessage({ ok: true, text: "نُزع الدور." });
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
          <Heading level="h1">الأدوار والإسناد</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}). تحتاج صلاحية «إدارة الأدوار».</Text>
        </Container>
      </Rtl>
    );
  }

  const userLabel = (id: string) => {
    const u = users.find((x) => x.id === id);
    if (!u) return id;
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return name ? `${name} — ${u.email}` : u.email;
  };

  return (
    <Rtl>
      <Container>
        <Heading level="h1">الأدوار والإسناد</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          الصلاحياتُ تُقرأ ولا تُعدَّل من هنا — تغييرُها قرارُ بنيةٍ لا ضبطُ
          تشغيل. والقابلُ للضبط هو الحدّ.
        </Text>

        {message && (
          <Text className={message.ok ? "text-ui-fg-interactive" : "text-ui-fg-error"} style={{ marginTop: 12 }}>
            {message.text}
          </Text>
        )}

        <Heading level="h2" style={{ marginTop: 24 }}>الأدوار</Heading>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>الدور</Table.HeaderCell>
              <Table.HeaderCell>الصلاحيات</Table.HeaderCell>
              <Table.HeaderCell>الحدود</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(roles ?? []).map((r) => (
              <Table.Row key={r.id}>
                <Table.Cell>
                  <Text weight="plus">{r.name_ar}</Text>
                  <Text size="small" className="text-ui-fg-subtle">{r.slug}</Text>
                </Table.Cell>
                <Table.Cell>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 460 }}>
                    {r.permissions.length === 0 ? (
                      <Text size="small" className="text-ui-fg-subtle">—</Text>
                    ) : (
                      r.permissions.map((p) => <Badge key={p} size="2xsmall">{p}</Badge>)
                    )}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  {r.limits.length === 0 ? (
                    <Text size="small" className="text-ui-fg-subtle">بلا حدّ</Text>
                  ) : (
                    r.limits.map((l) => (
                      <Text key={l.permission_slug} size="small">
                        {l.permission_slug}
                        {l.max_amount != null && ` · سقف ${riyals(Number(l.max_amount))} ر.س`}
                        {l.max_count != null && ` · ${l.max_count} مرّة`}
                        {l.requires_second_approval && " · بموافقةٍ ثانية"}
                      </Text>
                    ))
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        <Heading level="h2" style={{ marginTop: 24 }}>ضبطُ حدّ</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          ⚠️ اسمُ صلاحيةٍ غيرِ موجودةٍ يُرفض — وحدٌّ على اسمٍ خاطئٍ يبدو
          سقفاً في اللوحة ولا يحرس شيئاً.
        </Text>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginTop: 12 }}>
          <div style={{ minWidth: 200 }}>
            <Label size="small">الدور</Label>
            <Select value={editRole} onValueChange={setEditRole}>
              <Select.Trigger><Select.Value placeholder="اختر دوراً" /></Select.Trigger>
              <Select.Content>
                {(roles ?? []).map((r) => (
                  <Select.Item key={r.id} value={r.id}>{r.name_ar}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div style={{ minWidth: 200 }}>
            <Label size="small">الصلاحية</Label>
            <Select value={permSlug} onValueChange={setPermSlug}>
              <Select.Trigger><Select.Value placeholder="اختر صلاحية" /></Select.Trigger>
              <Select.Content>
                {((roles ?? []).find((r) => r.id === editRole)?.permissions ?? []).map((p) => (
                  <Select.Item key={p} value={p}>{p}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div>
            <Label size="small">السقف (ر.س — فارغٌ = بلا سقف)</Label>
            <Input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="مثال 500" />
          </div>
          <div>
            <Label size="small">عددُ المرّات (فارغٌ = بلا حدّ)</Label>
            <Input value={maxCount} onChange={(e) => setMaxCount(e.target.value)} placeholder="مثال 10" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch checked={second} onCheckedChange={setSecond} id="second" />
            <Label size="small" htmlFor="second">يحتاج موافقةً ثانية</Label>
          </div>
          <Button onClick={saveLimit} disabled={busy || !editRole || !permSlug}>حفظُ الحدّ</Button>
        </div>

        <Heading level="h2" style={{ marginTop: 32 }}>من يحمل ماذا</Heading>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>المستخدم</Table.HeaderCell>
              <Table.HeaderCell>الدور</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(assignments ?? []).map((a) => (
              <Table.Row key={a.id}>
                <Table.Cell>{userLabel(a.user_id)}</Table.Cell>
                <Table.Cell>{a.role?.name_ar ?? a.role_id}</Table.Cell>
                <Table.Cell>
                  <Button variant="danger" size="small" disabled={busy} onClick={() => revoke(a)}>
                    نزع
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginTop: 16 }}>
          <div style={{ minWidth: 260 }}>
            <Label size="small">المستخدم</Label>
            {users.length ? (
              <Select value={newUser} onValueChange={setNewUser}>
                <Select.Trigger><Select.Value placeholder="اختر مستخدماً" /></Select.Trigger>
                <Select.Content>
                  {users.map((u) => (
                    <Select.Item key={u.id} value={u.id}>{userLabel(u.id)}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            ) : (
              <Input value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="user_…" />
            )}
          </div>
          <div style={{ minWidth: 200 }}>
            <Label size="small">الدور</Label>
            <Select value={newRole} onValueChange={setNewRole}>
              <Select.Trigger><Select.Value placeholder="اختر دوراً" /></Select.Trigger>
              <Select.Content>
                {(roles ?? []).map((r) => (
                  <Select.Item key={r.id} value={r.id}>{r.name_ar}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <Button onClick={assign} disabled={busy || !newUser || !newRole}>إسناد</Button>
        </div>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الأدوار والإسناد" });

export default RolesPage;
