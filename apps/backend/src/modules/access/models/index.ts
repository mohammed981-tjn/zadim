// حاجزُ تصدير. لا يُقرأ من مُحمِّل النماذج — فهو يتخطّى أي ملفٍ يبدأ
// بـ`index.` عمداً — بل يخدم استيرادَ الخدمة وحدَها.
export { Permission } from "./permission";
export { Role } from "./role";
export { RoleLimit } from "./role-limit";
export { UserRole } from "./user-role";
export { AuditLog } from "./audit-log";
