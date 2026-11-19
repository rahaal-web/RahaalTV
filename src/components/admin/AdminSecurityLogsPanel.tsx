import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  Copy,
  ExternalLink,
  History,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { getActiveFirebaseConfig } from '../../lib/firebase';
import firestoreRulesSource from '../../../firestore.rules?raw';
import {
  AdminActivityLogEntry,
  clearActivityLog,
  loadActivityLog,
  subscribeActivityLogsFromFirestore,
} from '../../lib/adminAssistantDb';
import {
  clearClientErrorLogs,
  ClientErrorRecord,
  loadClientErrorLogs,
} from '../../lib/adminPreferences';
import { safeCopyToClipboard } from '../../lib/browserCompat';
import { AdminActivityLog } from '../AdminActivityLog';

interface AdminSecurityLogsPanelProps {
  mode: 'security_rules' | 'audit_logs';
  onNotify: (msg: string) => void;
}

export function AdminSecurityLogsPanel({ mode, onNotify }: AdminSecurityLogsPanelProps) {
  const [activityLogs, setActivityLogs] = useState<AdminActivityLogEntry[]>(() =>
    loadActivityLog()
  );
  const [syncMode, setSyncMode] = useState<'firestore+local' | 'local'>('local');
  const [clientErrors, setClientErrors] = useState<ClientErrorRecord[]>(() =>
    loadClientErrorLogs()
  );
  const [subView, setSubView] = useState<'admin' | 'client'>('admin');

  useEffect(() => {
    if (mode !== 'audit_logs') return;
    setClientErrors(loadClientErrorLogs());
    const unsub = subscribeActivityLogsFromFirestore(
      (entries) => setActivityLogs(entries),
      (st) => setSyncMode(st)
    );
    return () => unsub();
  }, [mode]);

  const activeFirebaseConfig = getActiveFirebaseConfig();

  if (mode === 'security_rules') {
    return (
      <div className="space-y-6">
        <div className="rounded-3xl bg-[#0c1821] border border-[#f9c400]/25 p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 flex-1 min-w-[240px]">
              <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#f9c400]" />
                <span>قواعد أمان Firestore المطلوبة للمنصة</span>
              </h2>
              <p className="text-xs leading-relaxed text-[#b7c9ef]">
                تحمي هذه القواعد جميع مجموعات قاعدة البيانات (
                <span className="font-latin text-white">
                  media, settings, admins, admin_activity_logs, scraper_adapters, fonts, requests, users, ratings
                </span>
                ) وتمنع الكتابة غير المصرح بها على قاعدة{' '}
                <span className="font-latin text-[#f9c400]">
                  {activeFirebaseConfig.firestoreDatabaseId}
                </span>
                .
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const ok = await safeCopyToClipboard(firestoreRulesSource);
                  onNotify(
                    ok
                      ? 'تم نسخ قواعد firestore.rules الكاملة إلى الحافظة!'
                      : 'تعذر النسخ التلقائي — انسخ القواعد من الصندوق أدناه.'
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#f9c400] hover:bg-[#dfb20b] px-4 py-2.5 text-xs font-black text-[#06131c] cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>نسخ قواعد firestore.rules</span>
              </button>
              <a
                href={`https://console.firebase.google.com/project/${activeFirebaseConfig.projectId}/firestore/databases/${activeFirebaseConfig.firestoreDatabaseId}/rules`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 px-4 py-2.5 text-xs font-extrabold text-white"
              >
                <span>فتح محرر Rules في Firebase</span>
                <ExternalLink className="w-3.5 h-3.5 text-[#f9c400]" />
              </a>
            </div>
          </div>

          <ol className="list-decimal list-inside space-y-1.5 text-xs text-[#b7c9ef] bg-[#1a242e]/65 border border-white/5 rounded-2xl p-4">
            <li>اضغط على زر &quot;نسخ قواعد firestore.rules&quot; أعلاه.</li>
            <li>
              افتح محرر Rules في Firebase Console وتأكد من اختيار القاعدة{' '}
              <span className="font-latin text-[#f9c400]">{activeFirebaseConfig.firestoreDatabaseId}</span>.
            </li>
            <li>استبدل القواعد بالكامل ثم اضغط Publish لتفعيل التغييرات فوراً.</li>
          </ol>

          <pre
            dir="ltr"
            className="max-h-96 overflow-auto rounded-2xl bg-[#06131c] border border-white/10 p-4 text-[11px] font-latin text-[#b7c9ef] leading-relaxed"
          >
            {firestoreRulesSource}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-[#f9c400]" />
            <span>سجل نشاطات الإدارة وأخطاء العميل</span>
          </h2>
          <p className="text-xs text-[#b7c9ef] mt-1">
            مراقبة جميع عمليات النشر والتعديل والحذف الإدارية، بالإضافة إلى أخطاء التشغيل المرصودة على المتصفح.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-xl bg-[#1a242e] p-1 border border-white/10">
          <button
            type="button"
            onClick={() => setSubView('admin')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold cursor-pointer ${
              subView === 'admin' ? 'bg-[#D92321] text-white' : 'text-[#b7c9ef]'
            }`}
          >
            سجل الإدارة ({activityLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setSubView('client')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold cursor-pointer ${
              subView === 'client' ? 'bg-[#D92321] text-white' : 'text-[#b7c9ef]'
            }`}
          >
            أخطاء المتصفح ({clientErrors.length})
          </button>
        </div>
      </div>

      {subView === 'admin' ? (
        <AdminActivityLog
          logs={activityLogs}
          syncMode={syncMode}
          onClearLogs={async () => {
            const cleared = await clearActivityLog(true);
            setActivityLogs(cleared);
            onNotify('تم مسح سجل العمليات الإدارية.');
          }}
        />
      ) : (
        <div className="rounded-3xl bg-[#0c1821] border border-white/[0.08] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-sm font-extrabold text-white flex items-center gap-2">
              <Bug className="w-4 h-4 text-[#ff8a88]" />
              <span>سجل أخطاء المتصفح والعميل المحلية ({clientErrors.length})</span>
            </h3>
            {clientErrors.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearClientErrorLogs();
                  setClientErrors([]);
                  onNotify('تم مسح سجل أخطاء المتصفح المحلية.');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/15 hover:bg-[#D92321] border border-[#D92321]/40 px-3 py-1.5 text-xs font-bold text-[#ff9f9d] hover:text-white cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>تنظيف السجل</span>
              </button>
            )}
          </div>

          {clientErrors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-xs text-[#b7c9ef]">
              لم تُسجل أي أخطاء غير معالجة في جلسات هذا المتصفح.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
              {clientErrors.map((err) => (
                <div
                  key={err.id}
                  className="rounded-2xl bg-[#1a242e]/70 border border-white/[0.08] p-3.5 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#ff9f9d]">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span className="font-latin">{err.scope}</span>
                    </span>
                    <span className="font-latin text-[10px] text-[#b7c9ef]">
                      {new Date(err.createdAt).toLocaleString('ar-EG')}
                    </span>
                  </div>
                  <p className="font-latin text-xs text-white break-words" dir="ltr">
                    {err.message}
                  </p>
                  {err.stack && (
                    <pre
                      dir="ltr"
                      className="max-h-24 overflow-auto rounded-lg bg-[#06131c] p-2 text-[10px] font-latin text-[#b7c9ef]/80"
                    >
                      {err.stack}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
