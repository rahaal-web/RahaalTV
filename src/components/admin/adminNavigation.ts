// Exact 9-group RTL Admin Navigation Architecture & Permission Mapping.

import type { ModeratorSubPermissions } from '../../lib/adminPreferences';

export type AdminTab =
  | 'overview'
  | 'notifications'
  | 'analytics'
  | 'catalog'
  | 'categories'
  | 'bulk_editor'
  | 'images'
  | 'content_audit'
  | 'watch_servers'
  | 'player_theme'
  | 'popup_shield'
  | 'scraper'
  | 'site_scraper'
  | 'scraper_adapters'
  | 'crawl_operations'
  | 'home_builder'
  | 'typography'
  | 'display_modes'
  | 'requests'
  | 'users'
  | 'security_rules'
  | 'audit_logs'
  | 'system_health'
  | 'backup_restore'
  | 'settings'
  | 'ai_editor';

export type AdminNavGroupId =
  | 'dashboard'
  | 'content'
  | 'player_servers'
  | 'crawlers'
  | 'design'
  | 'community'
  | 'security'
  | 'system'
  | 'settings_group';

export interface AdminNavItem {
  id: AdminTab;
  groupId: AdminNavGroupId;
  label: string;
  shortLabel: string;
  description: string;
  keywords: string[];
  ownerOnly?: boolean;
  moderatorPermKey?: keyof ModeratorSubPermissions;
}

export interface AdminNavGroup {
  id: AdminNavGroupId;
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: 'dashboard',
    label: 'لوحة القيادة والتحليلات',
    items: [
      {
        id: 'overview',
        groupId: 'dashboard',
        label: 'لوحة القيادة التنفيذية',
        shortLabel: 'نظرة عامة',
        description: 'مؤشرات الأداء اليومية، صحة المحتوى، وتنبيهات النظام السريعة',
        keywords: ['overview', 'dashboard', 'نظرة', 'احصائيات', 'لوحة'],
        ownerOnly: true,
      },
      {
        id: 'notifications',
        groupId: 'dashboard',
        label: 'مركز الإشعارات والتنبيهات',
        shortLabel: 'الإشعارات',
        description: 'تنبيهات الطلبات المعلّقة، السيرفرات المعطلة، مهام الجلب، وأخطاء النظام',
        keywords: ['notifications', 'alerts', 'اشعارات', 'تنبيهات', 'تحذيرات'],
      },
      {
        id: 'analytics',
        groupId: 'dashboard',
        label: 'التحليلات المتقدمة',
        shortLabel: 'التحليلات',
        description: 'أعلى الأعمال مشاهدة وتقييماً وتوزيع التصنيفات والجودات',
        keywords: ['analytics', 'views', 'ratings', 'تحليلات', 'مشاهدات', 'تقييمات'],
        moderatorPermKey: 'allowAnalyticsRead',
      },
    ],
  },
  {
    id: 'content',
    label: 'إدارة المحتوى والكتالوج',
    items: [
      {
        id: 'catalog',
        groupId: 'content',
        label: 'الأفلام والمسلسلات',
        shortLabel: 'الكتالوج',
        description: 'إضافة، تعديل، تثبيت، وفرز كافة الأعمال والحلقات',
        keywords: ['catalog', 'movies', 'series', 'افلام', 'مسلسلات', 'كتالوج'],
      },
      {
        id: 'categories',
        groupId: 'content',
        label: 'التصنيفات والأقسام والوسوم',
        shortLabel: 'التصنيفات',
        description: 'إحصائيات الأقسام والأنواع والجودات والدمج أو إعادة التسمية الجماعية',
        keywords: ['categories', 'genres', 'tags', 'تصنيفات', 'اقسام', 'انواع'],
        moderatorPermKey: 'allowBulkEditor',
      },
      {
        id: 'bulk_editor',
        groupId: 'content',
        label: 'التعديل الجماعي السريع',
        shortLabel: 'تعديل جماعي',
        description: 'تحديد عدة أعمال وتعديل الجودة/القسم/التصنيف/الحالة دفعة واحدة مع تراجع فوري',
        keywords: ['bulk', 'edit', 'batch', 'تعديل جماعي', 'تحديث'],
        moderatorPermKey: 'allowBulkEditor',
      },
      {
        id: 'images',
        groupId: 'content',
        label: 'جودة وإدارة الصور',
        shortLabel: 'الصور',
        description: 'فحص ومعالجة البوسترات وخلفيات العرض بدقة عالية',
        keywords: ['images', 'posters', 'backdrops', 'صور', 'بوسترات'],
      },
      {
        id: 'content_audit',
        groupId: 'content',
        label: 'فحص جودة المحتوى',
        shortLabel: 'فحص المحتوى',
        description: 'كشف التكرارات، الحلقات الناقصة، السيرفرات المفقودة والبيانات غير المكتملة',
        keywords: ['audit', 'duplicates', 'gaps', 'فحص', 'تكرار', 'ناقص'],
        moderatorPermKey: 'allowContentAudit',
      },
    ],
  },
  {
    id: 'player_servers',
    label: 'المشاهدة والسيرفرات والحماية',
    items: [
      {
        id: 'watch_servers',
        groupId: 'player_servers',
        label: 'صحة وسيرفرات المشاهدة',
        shortLabel: 'السيرفرات',
        description: 'جرد النطاقات، فحص الروابط المعطلة جماعياً، وكشف الروابط المشبوهة',
        keywords: ['servers', 'health', 'links', 'سيرفرات', 'روابط', 'مشاهدة'],
        moderatorPermKey: 'allowWatchServers',
      },
      {
        id: 'player_theme',
        groupId: 'player_servers',
        label: 'تخصيص ثيم المشغّل',
        shortLabel: 'مظهر المشغل',
        description: 'ألوان إطار المشاهدة، الحواف، التوهج، واسم العلامة التجارية',
        keywords: ['player', 'theme', 'colors', 'مشغل', 'ثيم', 'الوان'],
        ownerOnly: true,
      },
      {
        id: 'popup_shield',
        groupId: 'player_servers',
        label: 'درع النوافذ المنبثقة',
        shortLabel: 'درع الإعلانات',
        description: 'قواعد عزل الإطارات (Sandbox) وحماية المشاهد من النوافذ المنبثقة',
        keywords: ['shield', 'popup', 'sandbox', 'درع', 'نوافذ', 'اعلانات'],
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'crawlers',
    label: 'أدوات الجلب والاستيراد',
    items: [
      {
        id: 'scraper',
        groupId: 'crawlers',
        label: 'جلب عمل واحد (رابط)',
        shortLabel: 'جلب عمل',
        description: 'استيراد فيلم أو مسلسل من رابط مباشر أو مصدر HTML',
        keywords: ['scraper', 'single', 'import', 'جلب', 'استيراد', 'رابط'],
      },
      {
        id: 'site_scraper',
        groupId: 'crawlers',
        label: 'جلب موقع بالكامل (Crawler)',
        shortLabel: 'جلب موقع',
        description: 'مسح أقسام كاملة وجلب قائمة أعمال ونشرها دفعة واحدة',
        keywords: ['crawler', 'site', 'bulk import', 'جلب موقع', 'زاحف'],
        moderatorPermKey: 'allowSiteScraper',
      },
      {
        id: 'scraper_adapters',
        groupId: 'crawlers',
        label: 'تطوير مصادر الجلب',
        shortLabel: 'المحولات',
        description: 'إنشاء وتخصيص قواعد استخراج المواقع الخارجية (Adapters)',
        keywords: ['adapters', 'builder', 'sources', 'مصادر', 'محولات'],
        moderatorPermKey: 'allowAdapters',
      },
      {
        id: 'crawl_operations',
        groupId: 'crawlers',
        label: 'عمليات ومهام الجلب',
        shortLabel: 'المهام الحية',
        description: 'متابعة مهام الجلب الجارية وإيقافها ومراجعة سجل العمليات السابقة',
        keywords: ['tasks', 'jobs', 'queue', 'cancel', 'عمليات', 'مهام'],
        moderatorPermKey: 'allowCrawlOperations',
      },
      {
        id: 'ai_editor',
        groupId: 'crawlers',
        label: 'المساعد الذكي المحلي',
        shortLabel: 'المساعد الذكي',
        description: 'تعديل ذكي بالأوامر العربية للمحتوى والسيرفرات',
        keywords: ['ai', 'assistant', 'smart', 'مساعد', 'ذكي'],
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'design',
    label: 'التصميم والواجهة والأجهزة',
    items: [
      {
        id: 'home_builder',
        groupId: 'design',
        label: 'الصفحة الرئيسية والسلايدر',
        shortLabel: 'الرئيسية',
        description: 'ترتيب أقسام الرئيسية وإعدادات السلايدر السينمائي',
        keywords: ['home', 'hero', 'slider', 'sections', 'رئيسية', 'سلايدر'],
        ownerOnly: true,
      },
      {
        id: 'typography',
        groupId: 'design',
        label: 'الخطوط وحجم النصوص',
        shortLabel: 'الخطوط',
        description: 'تخصيص الخطوط العربية واللاتينية وأحجام العناوين',
        keywords: ['typography', 'fonts', 'size', 'خطوط', 'نصوص'],
        ownerOnly: true,
      },
      {
        id: 'display_modes',
        groupId: 'design',
        label: 'أوضاع الموبايل والتلفاز (TV)',
        shortLabel: 'أوضاع العرض',
        description: 'تفعيل وضع Android TV / Google TV، وضع الأجهزة الضعيفة، وتشخيص المتصفح',
        keywords: ['tv', 'mobile', 'android', 'dpad', 'compat', 'تلفاز', 'موبايل', 'توافق'],
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'community',
    label: 'الجمهور والطلبات',
    items: [
      {
        id: 'requests',
        groupId: 'community',
        label: 'طلبات الزوار',
        shortLabel: 'الطلبات',
        description: 'مراجعة واعتماد وتنفيذ طلبات الأفلام والمسلسلات',
        keywords: ['requests', 'visitors', 'طلبات', 'زوار'],
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'security',
    label: 'الأمان والصلاحيات والسجلات',
    items: [
      {
        id: 'users',
        groupId: 'security',
        label: 'الأعضاء والمشرفين (RBAC)',
        shortLabel: 'الصلاحيات',
        description: 'إدارة حسابات المشرفين ومصفوفة الصلاحيات الدقيقة وقائمة الأعضاء',
        keywords: ['users', 'admins', 'rbac', 'roles', 'مشرفين', 'اعضاء', 'صلاحيات'],
        ownerOnly: true,
      },
      {
        id: 'security_rules',
        groupId: 'security',
        label: 'قواعد أمان Firestore',
        shortLabel: 'قواعد Firestore',
        description: 'معاينة ونسخ قواعد أمان قاعدة البيانات والتحقق من النشر',
        keywords: ['firestore', 'rules', 'security', 'قواعد', 'امان'],
        ownerOnly: true,
      },
      {
        id: 'audit_logs',
        groupId: 'security',
        label: 'سجل النشاطات والأخطاء',
        shortLabel: 'السجلات',
        description: 'سجل عمليات الإدارة السحابي + أخطاء المتصفح والعميل المسجلة',
        keywords: ['logs', 'audit', 'errors', 'سجل', 'نشاطات', 'اخطاء'],
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'system',
    label: 'صحة النظام والنسخ الاحتياطي',
    items: [
      {
        id: 'system_health',
        groupId: 'system',
        label: 'مركز صحة النظام والربط',
        shortLabel: 'صحة النظام',
        description: 'فحص فوري لـ Firebase Auth و Firestore و Worker والخادم والقدرات',
        keywords: ['health', 'diagnostics', 'firebase', 'worker', 'صحة', 'فحص', 'اتصال'],
        ownerOnly: true,
      },
      {
        id: 'backup_restore',
        groupId: 'system',
        label: 'النسخ الاحتياطي والاستعادة',
        shortLabel: 'النسخ الاحتياطي',
        description: 'تصدير JSON موثّق ببصمة FNV-1a ومعاينة الفروقات قبل الاستعادة',
        keywords: ['backup', 'restore', 'export', 'import', 'نسخ', 'استعادة'],
        ownerOnly: true,
      },
    ],
  },
  {
    id: 'settings_group',
    label: 'الإعدادات العامة',
    items: [
      {
        id: 'settings',
        groupId: 'settings_group',
        label: 'إعدادات المنصة والبروكسي',
        shortLabel: 'الإعدادات',
        description: 'اسم الموقع، شريط الأخبار، وضع الصيانة، وبروكسي Cloudflare Worker',
        keywords: ['settings', 'maintenance', 'worker', 'proxy', 'اعدادات', 'صيانة'],
        ownerOnly: true,
      },
    ],
  },
];

export function getAllAdminNavItems(): AdminNavItem[] {
  return ADMIN_NAV_GROUPS.flatMap((g) => g.items);
}

export function findAdminNavItem(tab: AdminTab): {
  group: AdminNavGroup;
  item: AdminNavItem;
} | null {
  for (const group of ADMIN_NAV_GROUPS) {
    const item = group.items.find((i) => i.id === tab);
    if (item) return { group, item };
  }
  return null;
}

export function isTabAccessible(
  tab: AdminTab,
  isOwner: boolean,
  moderatorPerms: ModeratorSubPermissions
): boolean {
  if (isOwner) return true;
  const found = findAdminNavItem(tab);
  if (!found) return false;
  if (found.item.ownerOnly) return false;
  if (found.item.moderatorPermKey) {
    return Boolean(moderatorPerms[found.item.moderatorPermKey]);
  }
  return true;
}
