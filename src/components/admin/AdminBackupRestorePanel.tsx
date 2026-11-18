import { ChangeEvent, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  Loader2,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import {
  BackupValidationResult,
  createSiteBackupPayload,
  validateBackupJson,
} from '../../lib/backupRestore';
import { saveDisplayDevicePrefs } from '../../lib/browserCompat';
import { bulkSaveMediaToFirestore, saveSiteSettingsToFirestore } from '../../lib/firebase';
import { appendActivityLog } from '../../lib/adminAssistantDb';
import { MediaItem, ScraperAdapter, SiteSettings, VisitorRequest } from '../../types/media';

interface AdminBackupRestorePanelProps {
  catalog: MediaItem[];
  siteSettings: SiteSettings;
  adapters: ScraperAdapter[];
  requests: VisitorRequest[];
  adminUid: string;
  adminName: string;
  onNotify: (msg: string) => void;
}

export function AdminBackupRestorePanel({
  catalog,
  siteSettings,
  adapters,
  requests,
  adminUid,
  adminName,
  onNotify,
}: AdminBackupRestorePanelProps) {
  const [validation, setValidation] = useState<BackupValidationResult | null>(null);
  const [restoreSettingsFlag, setRestoreSettingsFlag] = useState(true);
  const [restoreMediaFlag, setRestoreMediaFlag] = useState(true);
  const [confirmStep, setConfirmStep] = useState<0 | 1>(0);
  const [busyRestore, setBusyRestore] = useState(false);

  const handleExportFullBackup = () => {
    const payload = createSiteBackupPayload({
      settings: siteSettings,
      media: catalog,
      adapters,
      requests,
    });
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rahaltv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify(`تم تصدير نسخة احتياطية كاملة (${catalog.length} عمل) ببصمة تحقق ${payload.checksum}.`);
  };

  const handleSelectBackupFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setConfirmStep(0);
    try {
      const text = await file.text();
      const result = validateBackupJson(text, catalog);
      setValidation(result);
      if (result.valid) {
        onNotify('تم فحص ملف النسخة الاحتياطية — راجع معاينة الفروقات أدناه قبل الاستعادة.');
      } else {
        onNotify('ملف النسخة الاحتياطية يحتوي على أخطاء في البنية.');
      }
    } catch {
      onNotify('تعذر قراءة الملف المختار.');
    } finally {
      e.target.value = '';
    }
  };

  const handleExecuteRestore = async () => {
    if (!validation?.valid || !validation.payload) return;
    setBusyRestore(true);
    try {
      const { data } = validation.payload;
      let restoredMediaCount = 0;

      if (restoreMediaFlag && Array.isArray(data.media) && data.media.length > 0) {
        await bulkSaveMediaToFirestore(data.media, adminUid);
        restoredMediaCount = data.media.length;
      }

      if (restoreSettingsFlag && data.settings && data.settings.siteName) {
        await saveSiteSettingsToFirestore(data.settings, adminUid);
      }

      if (data.displayPrefs) {
        saveDisplayDevicePrefs(data.displayPrefs);
      }

      appendActivityLog({
        adminUid,
        adminName,
        rawCommand: 'استعادة نسخة احتياطية كاملة',
        understoodCommand: `استعادة ${restoredMediaCount} عمل${restoreSettingsFlag ? ' + الإعدادات' : ''}`,
        operationType: 'backup_restore',
        operationLabel: 'استعادة نسخة احتياطية',
        affectedCount: restoredMediaCount,
        sampleTitles: data.media.slice(0, 5).map((m) => m.title),
        status: 'executed',
      });

      onNotify(
        `تمت الاستعادة بنجاح: ${restoredMediaCount} عمل${restoreSettingsFlag ? ' وإعدادات المنصة' : ''}.`
      );
      setConfirmStep(0);
    } catch (err) {
      onNotify(`فشل الاستعادة: ${err instanceof Error ? err.message : 'خطأ في Firestore'}`);
    } finally {
      setBusyRestore(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
              <FileJson className="w-5 h-5 text-[#f9c400]" />
              <span>مركز النسخ الاحتياطي والاستعادة الآمنة</span>
            </h2>
            <p className="text-xs text-[#b7c9ef] mt-1">
              تصدير نسخة كاملة بصيغة JSON v2 موثّقة ببصمة FNV-1a، أو رفع نسخة سابقة لفحصها ومعاينة الفروقات قبل كتابتها في Firestore.
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportFullBackup}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-5 py-3 text-xs font-extrabold text-white shadow-lg cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تصدير نسخة احتياطية كاملة ({catalog.length} عمل)</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="rounded-2xl bg-[#1a242e]/70 border border-white/5 p-3.5 text-xs">
            <span className="text-[#b7c9ef]">الأعمال المشمولة:</span>
            <p className="text-lg font-black text-white mt-0.5 tabular-nums">{catalog.length}</p>
          </div>
          <div className="rounded-2xl bg-[#1a242e]/70 border border-white/5 p-3.5 text-xs">
            <span className="text-[#b7c9ef]">محولات الجلب:</span>
            <p className="text-lg font-black text-white mt-0.5 tabular-nums">{adapters.length}</p>
          </div>
          <div className="rounded-2xl bg-[#1a242e]/70 border border-white/5 p-3.5 text-xs">
            <span className="text-[#b7c9ef]">طلبات الزوار:</span>
            <p className="text-lg font-black text-white mt-0.5 tabular-nums">{requests.length}</p>
          </div>
        </div>
      </div>

      {/* Upload & Validate Section */}
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-extrabold text-white">
              استعادة من ملف JSON (فحص + معاينة فروقات + تأكيد مزدوج)
            </h3>
            <p className="text-xs text-[#b7c9ef] mt-0.5">
              لن يتم تعديل أي بيانات في Firestore بمجرد اختيار الملف — ستظهر أولاً نتيجة الفحص والمقارنة.
            </p>
          </div>

          <label className="inline-flex items-center gap-2 rounded-xl bg-[#1a242e] hover:bg-white/10 border border-[#f9c400]/45 px-4 py-2.5 text-xs font-extrabold text-[#f9c400] cursor-pointer">
            <Upload className="w-4 h-4" />
            <span>اختيار ملف نسخة (.json)</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleSelectBackupFile(e)}
              className="hidden"
            />
          </label>
        </div>

        {validation && (
          <div className="space-y-4 border-t border-white/10 pt-4">
            {validation.errors.length > 0 && (
              <div className="rounded-2xl bg-[#D92321]/15 border border-[#D92321]/45 p-4 space-y-1 text-xs text-[#ffb3b1]">
                {validation.errors.map((err, i) => (
                  <p key={i} className="flex items-center gap-2 font-bold">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>{err}</span>
                  </p>
                ))}
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className="rounded-2xl bg-[#f9c400]/10 border border-[#f9c400]/35 p-4 space-y-1 text-xs text-[#fde68a]">
                {validation.warnings.map((w, i) => (
                  <p key={i} className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}

            {validation.valid && validation.diff && validation.payload && (
              <div className="rounded-2xl bg-[#1a242e] border border-[#4CAF50]/40 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#4CAF50]">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>تم التحقق من صحة النسخة الاحتياطية بنجاح</span>
                  </span>
                  <span className="font-latin text-[11px] text-[#b7c9ef]">
                    Checksum: {validation.payload.checksum} • {validation.payload.exportedAt.slice(0, 10)}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-xl bg-[#0c1821] p-3">
                    <span className="text-[10px] text-[#b7c9ef]">إجمالي الأعمال بالملف</span>
                    <p className="text-base font-black text-white mt-0.5 tabular-nums">
                      {validation.diff.incomingMediaCount}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#0c1821] p-3">
                    <span className="text-[10px] text-[#b7c9ef]">أعمال جديدة ستُضاف</span>
                    <p className="text-base font-black text-[#4CAF50] mt-0.5 tabular-nums">
                      +{validation.diff.newItemsCount}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#0c1821] p-3">
                    <span className="text-[10px] text-[#b7c9ef]">أعمال قائمة ستُحدّث</span>
                    <p className="text-base font-black text-[#f9c400] mt-0.5 tabular-nums">
                      {validation.diff.updatedItemsCount}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#0c1821] p-3">
                    <span className="text-[10px] text-[#b7c9ef]">إعدادات الموقع</span>
                    <p className="text-base font-black text-white mt-0.5">
                      {validation.diff.hasSettings ? 'مشمولة' : 'غير مشمولة'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-xs font-bold text-white">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restoreMediaFlag}
                      onChange={(e) => setRestoreMediaFlag(e.target.checked)}
                      className="h-4 w-4 accent-[#4CAF50]"
                    />
                    <span>استعادة/دمج الأعمال ({validation.diff.incomingMediaCount})</span>
                  </label>
                  {validation.diff.hasSettings && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={restoreSettingsFlag}
                        onChange={(e) => setRestoreSettingsFlag(e.target.checked)}
                        className="h-4 w-4 accent-[#4CAF50]"
                      />
                      <span>استعادة إعدادات الموقع والتصميم</span>
                    </label>
                  )}
                </div>

                <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-3">
                  {confirmStep === 0 ? (
                    <button
                      type="button"
                      disabled={busyRestore || (!restoreMediaFlag && !restoreSettingsFlag)}
                      onClick={() => setConfirmStep(1)}
                      className="rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] disabled:opacity-50 px-5 py-2.5 text-xs font-black text-[#06131c] cursor-pointer"
                    >
                      بدء الاستعادة (الخطوة 1 من 2)
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busyRestore}
                        onClick={() => void handleExecuteRestore()}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] disabled:opacity-50 px-5 py-2.5 text-xs font-black text-white cursor-pointer"
                      >
                        {busyRestore ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShieldAlert className="w-4 h-4" />
                        )}
                        <span>تأكيد الكتابة الفعلية في Firestore الآن</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyRestore}
                        onClick={() => setConfirmStep(0)}
                        className="rounded-xl bg-white/10 px-4 py-2.5 text-xs font-bold text-white cursor-pointer"
                      >
                        تراجع
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
