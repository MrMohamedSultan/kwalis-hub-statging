# Kwalis HUB — Security Rules / قواعد الأمان

هذا الملف هو المرجع الثابت لكل تعديل أمني في المشروع. يُطبَّق تلقائياً على أي
تغيير في قاعدة البيانات أو الكود، من Lovable أو من Claude Code عبر GitHub.

---

## 1. Workflow — دورة العمل

1. المستخدم يكتب طلب الأمان في محادثة Lovable.
2. تشغيل الفحص الأمني (`security scan`) + مدقّق قاعدة البيانات (`linter`).
3. عرض النتائج: المشكلة / درجة الخطورة / الحل المقترح.
4. **انتظار موافقة المستخدم قبل تطبيق أي ترحيل (migration).**
5. تطبيق الإصلاح ثم تعليم النتائج كـ `fixed`.

صيغ الطلب المقبولة:

- "افحص الأمان وأصلح المشاكل الحرجة فقط"
- "راجع صلاحيات جدول `invoices` و`payments`"
- لصق نص التحذير من نتائج الفحص مباشرة.

---

## 2. Database rules — قواعد قاعدة البيانات

### ترتيب إلزامي لكل جدول جديد في `public`

```sql
-- 1) CREATE TABLE
CREATE TABLE public.<table> (...);

-- 2) GRANT  (بدون هذا الـ Data API يرجع permission error)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
GRANT ALL ON public.<table> TO service_role;
-- GRANT SELECT ... TO anon;  ← فقط إذا كانت هناك سياسة قراءة عامة صريحة

-- 3) ENABLE RLS
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

-- 4) POLICIES
CREATE POLICY ... ;
```

### قواعد ثابتة

- **الأدوار لا تُخزَّن أبداً** في `profiles` أو أي جدول مستخدمين. مكانها الوحيد
  `public.user_roles`، ويُتحقَّق منها عبر `has_role()` (SECURITY DEFINER).
- **عزل متعدد المستأجرين إلزامي**: كل سياسة وكل استعلام يجب أن يكون مقيّداً
  بالمنظمة/المشروع النشط عبر `is_org_member`, `can_access_project`,
  `is_project_member`, أو `is_super_admin`.
- **ممنوع** `USING (true)` أو `WITH CHECK (true)` على أي جدول يحتوي بيانات
  مستأجرين. الكتالوجات المشتركة (`master_budget`, `gl_accounts`,
  `budget_topsheet_accounts`) قراءة فقط للمصادَقين، والكتابة للمشرفين فقط.
- **`anon`**: لا صلاحيات إلا لبيانات عامة صريحة ومُراجَعة.
- **الدوال المساعدة** التي تُستخدم داخل سياسات RLS يجب أن تكون
  `SECURITY DEFINER` مع `SET search_path = public` لتفادي التكرار اللانهائي.
- **العروض (views)** التي تُقرأ من التطبيق يجب أن تكون
  `WITH (security_invoker = on)` حتى لا تتجاوز RLS.
- **لا تعديل** على مخططات `auth`, `storage`, `realtime`, `vault`,
  `supabase_functions` — ولا triggers عليها.

---

## 3. Application rules — قواعد التطبيق

- **التحقق من المدخلات على الخادم**: كل `createServerFn` يجب أن يمر عبر
  `.inputValidator()` مع `zod`. التحقق في الواجهة وحده غير كافٍ.
- **الصلاحيات على الخادم**: الشاشات الحساسة تُحمى بـ `requirePermission()` من
  `src/lib/rbac-permissions.functions.ts` و`guardRoutePermission()` في
  `beforeLoad`، وليس بإخفاء الأزرار فقط.
- **`supabaseAdmin`** (service role) يتجاوز RLS: يُستورد فقط داخل الـ handler
  بـ `await import("@/integrations/supabase/client.server")`، وبعد التحقق من
  هوية المتصل. ممنوع استخدامه للقراءات العادية أو لتحديد ما إذا كان المتصل
  مشرفاً.
- **نقاط `/api/public/*`** تتجاوز مصادقة الموقع: يجب التحقق من التوقيع أو
  السر المشترك داخل الـ handler قبل أي معالجة (انظر
  `src/routes/api/public/ai-job.ts` كنموذج بمقارنة ثابتة الزمن).
- **الأسرار**: تُقرأ من `process.env` داخل الـ handler فقط. ممنوع تسجيلها أو
  إرجاعها أو وضعها في متغيرات `VITE_*`. `SUPABASE_SERVICE_ROLE_KEY` وكلمة مرور
  قاعدة البيانات غير متاحة ولا يجوز طلبها أو تلفيقها.
- **نطاق المشروع**: أي طفرة (mutation) تمر عبر `assertProjectScope()` /
  `requireProjectId()` من `src/lib/project-scope-guard.ts`.
- **سجل التدقيق**: العمليات المالية والصلاحيات تُسجَّل في `audit_logs` /
  `audit_history`؛ ورفض الصلاحية يُسجَّل عبر `logPermissionDenied()`.

---

## 4. What must never happen — ما يجب ألا يحدث أبداً

- مستخدم من منظمة يقرأ أو يكتب بيانات منظمة أخرى.
- عضو مشروع يصل إلى مشاريع غير مُسنَدة له.
- ترقية صلاحيات عبر تعديل صف في `profiles` أو تخزين محلي (localStorage).
- تنفيذ دفعة أو اعتماد دون فصل Maker–Checker.
- كشف مفاتيح الخدمة أو روابط لوحة Supabase للمستخدم النهائي.

---

## 5. Regression testing

- `scripts/rls-regression.mjs` — اختبارات عزل RLS الآلية.
- `scripts/rls-fixture-tag.mjs` + `scripts/purge-rls-test-data.mjs` — وسم
  وتنظيف بيانات الاختبار دون المساس ببيانات الإنتاج.
- تُشغَّل ضمن `.github/workflows/db-performance.yml`، وتُتخطّى بتحذير عند غياب
  بيانات الاعتماد.

---

## 6. Standing coding protocols — بروتوكولات ثابتة لكل تعديل

تنطبق هذه القواعد تلقائياً على كل مخرجات الكود دون طلب متكرر.

### 6.1 Input defense — الدفاع عن المدخلات

- كل مدخل مستخدم (نماذج، بحث، باراميترات URL، مسارات API، حمولات server
  functions) يُتحقَّق منه بـ **Zod** في الواجهة _وفي_ الخادم. تحقق الواجهة
  للـ UX فقط؛ تحقق الخادم هو الحجة الفاصلة.
- حدود إلزامية: `.trim()`، `.max()` على كل نص، `.email()/.url()/.regex()`
  حيث ينطبق، حدود عددية `min/max`، وحد أقصى لطول المصفوفات.
- ممنوع `dangerouslySetInnerHTML` مع محتوى مستخدم. عند الحاجة لعرض HTML
  يُنقّى عبر DOMPurify.
- الروابط الخارجية تُطبَّع عبر `AttachmentUrlField` / `normalizeUrl` وتُقبل
  فقط `http(s)`؛ ممنوع `javascript:` و`data:`.
- أي قيمة تُدرج في URL تُشفَّر بـ `encodeURIComponent`.

### 6.2 Database integrity — سلامة قاعدة البيانات

- جميع الاستعلامات تمر عبر عميل Supabase (PostgREST) المُولَّد — وهو
  parameterized بطبيعته. ممنوع بناء SQL بسلاسل نصية.
- في دوال Postgres: `SECURITY DEFINER` + `SET search_path = public`،
  وباراميترات مُصرَّح بأنواعها. أي SQL ديناميكي يستخدم `format()` مع
  `%I`/`%L` أو `quote_ident`/`quote_literal` — لا دمج نصوص.
- RLS تبقى خط الدفاع الأخير حتى لو تحقّق التطبيق من المدخلات.

### 6.3 Secret management — إدارة الأسرار

- ممنوع كتابة أي مفتاح أو توكن أو كلمة مرور في الكود أو في ملفات مُلتزمة.
- الأسرار تُخزَّن عبر أدوات أسرار Lovable وتُقرأ من `process.env.X` **داخل**
  الـ handler. `import.meta.env.VITE_*` للقيم العامة فقط (URL والمفتاح
  القابل للنشر).
- ممنوع تسجيل الأسرار أو إرجاعها في أي استجابة أو رسالة خطأ.

### 6.4 API resilience — صلابة الواجهات

- المنصة لا توفّر حالياً بدائية موحّدة لتحديد المعدّل (rate limiting)، لذا
  لا تُضاف تطبيقات ارتجالية دون طلب صريح من المستخدم.
- ما يُطبَّق بدلاً منها في كل نقطة نهاية:
  - مصادقة إلزامية (`requireSupabaseAuth`) أو تحقق من سر مشترك/توقيع
    بمقارنة ثابتة الزمن في `/api/public/*`.
  - تحقق Zod صارم مع حدود حجم للحمولة قبل أي معالجة.
  - عمليات إبطال (idempotency) للعمليات المالية، وفصل Maker–Checker.
  - تسجيل المحاولات المرفوضة في `audit_logs` للكشف عن إساءة الاستخدام.
