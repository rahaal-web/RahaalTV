import { FormEvent, useState } from 'react';
import {
  Baby,
  Check,
  Edit3,
  KeyRound,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  PROFILE_AVATAR_PRESETS,
  removeSubProfile,
  upsertSubProfile,
  verifyProfilePin,
} from '../lib/profiles';
import type { AgeRatingTier, UserSubProfile } from '../types/media';

interface ProfileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string | null;
  profiles: UserSubProfile[];
  activeProfile: UserSubProfile;
  onProfilesChange: (next: UserSubProfile[]) => void;
  onSelectProfile: (profileId: string) => void;
  onNotify: (msg: string) => void;
}

const AGE_TIER_OPTIONS: Array<{ value: AgeRatingTier; label: string }> = [
  { value: 'all', label: 'كل التصنيفات العمرية (بدون تقييد)' },
  { value: '18+', label: 'حتى +18' },
  { value: '16+', label: 'حتى +16' },
  { value: '13+', label: 'حتى +13' },
  { value: 'kids', label: 'أطفال وعائلي فقط (Kids)' },
];

export function ProfileManagerModal({
  isOpen,
  onClose,
  uid,
  profiles,
  activeProfile,
  onProfilesChange,
  onSelectProfile,
  onNotify,
}: ProfileManagerModalProps) {
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('🎬');
  const [avatarColor, setAvatarColor] = useState('#dc2626');
  const [isKids, setIsKids] = useState(false);
  const [maxAgeRating, setMaxAgeRating] = useState<AgeRatingTier>('all');
  const [pinInput, setPinInput] = useState('');
  const [clearPin, setClearPin] = useState(false);
  const [busy, setBusy] = useState(false);

  // PIN verification gate state (when switching to a PIN-locked profile OR exiting Kids Mode when main profile has a PIN)
  const [pinChallenge, setPinChallenge] = useState<{
    targetProfile: UserSubProfile;
    verifierProfile: UserSubProfile;
    reasonLabel: string;
    action: 'switch' | 'edit';
  } | null>(null);
  const [challengePin, setChallengePin] = useState('');
  const [challengeError, setChallengeError] = useState('');

  if (!isOpen) return null;

  const mainProfile = profiles.find((p) => p.id === 'main') || profiles[0];

  const resetForm = () => {
    setEditingProfileId(null);
    setCreatingNew(false);
    setName('');
    setAvatarEmoji('🎬');
    setAvatarColor('#dc2626');
    setIsKids(false);
    setMaxAgeRating('all');
    setPinInput('');
    setClearPin(false);
  };

  const openEditorForProfile = (p: UserSubProfile) => {
    setCreatingNew(false);
    setEditingProfileId(p.id);
    setName(p.name);
    setAvatarEmoji(p.avatarEmoji || '🎬');
    setAvatarColor(p.avatarColor || '#dc2626');
    setIsKids(Boolean(p.isKids));
    setMaxAgeRating(p.isKids ? 'kids' : p.maxAgeRating || 'all');
    setPinInput('');
    setClearPin(false);
  };

  const handleRequestSwitch = (target: UserSubProfile) => {
    if (target.id === activeProfile.id) {
      onClose();
      return;
    }
    // Enforce PIN when leaving Kids Mode if either activeProfile or mainProfile holds a PIN
    if (activeProfile.isKids && !target.isKids) {
      const guardProfile = activeProfile.hasPin
        ? activeProfile
        : mainProfile?.hasPin
          ? mainProfile
          : null;
      if (guardProfile) {
        setChallengePin('');
        setChallengeError('');
        setPinChallenge({
          targetProfile: target,
          verifierProfile: guardProfile,
          reasonLabel: `أدخل رمز PIN للخروج من وضع الأطفال إلى "${target.name}"`,
          action: 'switch',
        });
        return;
      }
    }

    if (target.hasPin) {
      setChallengePin('');
      setChallengeError('');
      setPinChallenge({
        targetProfile: target,
        verifierProfile: target,
        reasonLabel: `الملف "${target.name}" محمي برمز PIN`,
        action: 'switch',
      });
      return;
    }

    onSelectProfile(target.id);
    onNotify(`تم التبديل إلى ملف "${target.name}"`);
    onClose();
  };

  const handleRequestEdit = (target: UserSubProfile) => {
    if (target.hasPin || (activeProfile.isKids && mainProfile?.hasPin)) {
      const verifier = target.hasPin ? target : mainProfile!;
      setChallengePin('');
      setChallengeError('');
      setPinChallenge({
        targetProfile: target,
        verifierProfile: verifier,
        reasonLabel: `أدخل رمز PIN لتعديل إعدادات "${target.name}"`,
        action: 'edit',
      });
      return;
    }
    openEditorForProfile(target);
  };

  const handleVerifyChallenge = async (e: FormEvent) => {
    e.preventDefault();
    if (!pinChallenge) return;
    const valid = await verifyProfilePin(challengePin, pinChallenge.verifierProfile);
    if (!valid) {
      setChallengeError('رمز PIN غير صحيح، حاول مرة أخرى');
      return;
    }
    const resolved = pinChallenge;
    setPinChallenge(null);
    setChallengePin('');
    setChallengeError('');
    if (resolved.action === 'switch') {
      onSelectProfile(resolved.targetProfile.id);
      onNotify(`تم التبديل إلى ملف "${resolved.targetProfile.name}"`);
      onClose();
    } else {
      openEditorForProfile(resolved.targetProfile);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onNotify('يرجى إدخال اسم الملف الشخصي');
      return;
    }
    if (pinInput.trim() && pinInput.trim().length < 4) {
      onNotify('يجب أن يتكون رمز PIN من 4 أرقام أو أحرف على الأقل');
      return;
    }
    setBusy(true);
    try {
      const targetId =
        editingProfileId || `prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      const existing = profiles.find((p) => p.id === targetId);
      const nextList = await upsertSubProfile({
        uid,
        profile: {
          id: targetId,
          name: name.trim(),
          avatarEmoji,
          avatarColor,
          isKids,
          maxAgeRating: isKids ? 'kids' : maxAgeRating,
          hasPin: existing?.hasPin || false,
          watchlistIds: existing?.watchlistIds || [],
          newPin: pinInput.trim() || undefined,
          clearPin,
        },
        existingProfiles: profiles,
      });
      onProfilesChange(nextList);
      if (creatingNew) {
        onSelectProfile(targetId);
      }
      onNotify(creatingNew ? 'تم إنشاء الملف الشخصي الجديد' : 'تم حفظ تعديلات الملف الشخصي');
      resetForm();
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (profileId === 'main') return;
    setBusy(true);
    try {
      const nextList = await removeSubProfile(uid, profileId, profiles);
      onProfilesChange(nextList);
      if (activeProfile.id === profileId) {
        onSelectProfile('main');
      }
      onNotify('تم حذف الملف الشخصي');
      resetForm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="إدارة ملفات المشاهدة"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl sm:rounded-3xl bg-[#0c1821] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 bg-[#1a242e] px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#E50914]" />
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold text-white">
                ملفات المشاهدة العائلية ({profiles.length}/5)
              </h2>
              <p className="text-[11px] text-[#b7c9ef]">
                خصص لكل فرد مكتبته وسجل مشاهدته ووضع الأطفال الآمن
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق نافذة الملفات"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white hover:bg-[#D92321] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 max-h-[78vh] overflow-y-auto space-y-5">
          {pinChallenge ? (
            <form
              onSubmit={handleVerifyChallenge}
              className="rounded-2xl bg-[#1a242e] border border-[#f9c400]/35 p-5 space-y-4 text-center"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f9c400]/15 text-[#f9c400]">
                <KeyRound className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-white">{pinChallenge.reasonLabel}</h3>
                <p className="text-xs text-[#b7c9ef] mt-1">
                  التحقق عبر رمز PIN المشفر لحماية إعدادات العائلة
                </p>
              </div>
              <input
                type="password"
                dir="ltr"
                autoFocus
                inputMode="numeric"
                value={challengePin}
                onChange={(e) => {
                  setChallengePin(e.target.value);
                  setChallengeError('');
                }}
                placeholder="••••"
                className="font-latin mx-auto block w-44 rounded-xl bg-[#0c1821] border border-white/15 px-4 py-3 text-center text-lg font-black tracking-[0.4em] text-white focus:border-[#f9c400] focus:outline-none"
              />
              {challengeError && (
                <p className="text-xs font-bold text-[#ff6b6b]">{challengeError}</p>
              )}
              <div className="flex items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setPinChallenge(null)}
                  className="rounded-xl bg-white/5 hover:bg-white/10 px-4 py-2 text-xs font-bold text-[#b7c9ef] cursor-pointer"
                >
                  رجوع
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#E50914] hover:bg-[#f40612] px-5 py-2 text-xs font-extrabold text-white cursor-pointer"
                >
                  تأكيد الرمز
                </button>
              </div>
            </form>
          ) : creatingNew || editingProfileId ? (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-white">
                  {creatingNew ? 'إنشاء ملف جديد' : 'تعديل الملف الشخصي'}
                </h3>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-bold text-[#b7c9ef] hover:text-white cursor-pointer"
                >
                  العودة للقائمة
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-[#b7c9ef]">اسم الملف</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  placeholder="مثال: أحمد / الأطفال / العائلة"
                  className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-2.5 text-sm font-bold text-white focus:border-[#E50914] focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#b7c9ef]">الأيقونة واللون</label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {PROFILE_AVATAR_PRESETS.map((preset) => {
                    const selected = avatarEmoji === preset.emoji && avatarColor === preset.color;
                    return (
                      <button
                        key={preset.emoji}
                        type="button"
                        onClick={() => {
                          setAvatarEmoji(preset.emoji);
                          setAvatarColor(preset.color);
                        }}
                        className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs font-bold transition-all cursor-pointer ${
                          selected
                            ? 'border-[#f9c400] bg-white/10 text-white'
                            : 'border-white/10 bg-[#1a242e]/70 text-[#b7c9ef] hover:border-white/25'
                        }`}
                      >
                        <span
                          style={{ backgroundColor: preset.color }}
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
                        >
                          {preset.emoji}
                        </span>
                        <span className="text-[10px]">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between gap-3 rounded-xl bg-[#1a242e] border border-white/10 px-3.5 py-3 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Baby className="w-4 h-4 text-[#4CAF50]" />
                    <div>
                      <p className="text-xs font-extrabold text-white">وضع الأطفال الآمن (Kids Mode)</p>
                      <p className="text-[10px] text-[#b7c9ef]">يخفي المحتوى +13 و+16 و+18 والرعب تلقائياً</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isKids}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setIsKids(next);
                      if (next) setMaxAgeRating('kids');
                    }}
                    className="h-4 w-4 accent-[#4CAF50]"
                  />
                </label>

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-[#b7c9ef]">الحد الأقصى للتصنيف العمري</label>
                  <select
                    value={isKids ? 'kids' : maxAgeRating}
                    disabled={isKids}
                    onChange={(e) => setMaxAgeRating(e.target.value as AgeRatingTier)}
                    className="w-full rounded-xl bg-[#1a242e] border border-white/10 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {AGE_TIER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-xl bg-[#1a242e]/80 border border-white/10 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-white">
                    <Lock className="w-3.5 h-3.5 text-[#f9c400]" />
                    <span>قفل الملف برمز PIN (اختياري)</span>
                  </span>
                  {editingProfileId &&
                    profiles.find((p) => p.id === editingProfileId)?.hasPin && (
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#ff8a8a] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={clearPin}
                          onChange={(e) => setClearPin(e.target.checked)}
                        />
                        <span>إلغاء القفل</span>
                      </label>
                    )}
                </div>
                <input
                  type="password"
                  dir="ltr"
                  inputMode="numeric"
                  disabled={clearPin}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="أدخل رمز من 4 أرقام لتعيينه أو تغييره"
                  className="font-latin w-full rounded-lg bg-[#0c1821] border border-white/10 px-3 py-2 text-xs text-white disabled:opacity-50"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                {editingProfileId && editingProfileId !== 'main' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDeleteProfile(editingProfileId)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#D92321]/15 border border-[#D92321]/40 px-3.5 py-2 text-xs font-bold text-[#ff7676] hover:bg-[#D92321] hover:text-white cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف الملف</span>
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-xl bg-white/5 hover:bg-white/10 px-4 py-2 text-xs font-bold text-[#b7c9ef] cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#4CAF50] hover:bg-[#43a047] px-5 py-2 text-xs font-extrabold text-white cursor-pointer disabled:opacity-60"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{busy ? 'جاري الحفظ...' : 'حفظ الملف'}</span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {profiles.map((prof) => {
                  const isActive = prof.id === activeProfile.id;
                  return (
                    <div
                      key={prof.id}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-3.5 transition-all ${
                        isActive
                          ? 'bg-[#E50914]/15 border-[#E50914]'
                          : 'bg-[#1a242e]/80 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleRequestSwitch(prof)}
                        className="flex flex-1 min-w-0 items-center gap-3 text-right cursor-pointer"
                      >
                        <span
                          style={{ backgroundColor: prof.avatarColor || '#dc2626' }}
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl shadow-md"
                        >
                          {prof.avatarEmoji || '🎬'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-extrabold text-white truncate">{prof.name}</p>
                            {prof.hasPin && <Lock className="w-3 h-3 text-[#f9c400] shrink-0" />}
                            {isActive && <Check className="w-4 h-4 text-[#4CAF50] shrink-0" />}
                          </div>
                          <p className="text-[11px] text-[#b7c9ef] mt-0.5 truncate">
                            {prof.isKids
                              ? 'وضع الأطفال الآمن (Kids)'
                              : prof.maxAgeRating === 'all'
                                ? 'وصول كامل لكل الأعمال'
                                : `تصنيف عمري حتى ${prof.maxAgeRating}`}
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRequestEdit(prof)}
                        aria-label={`تعديل ${prof.name}`}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-[#b7c9ef] hover:bg-white/15 hover:text-white cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {profiles.length < 5 && (
                <button
                  type="button"
                  onClick={() => {
                    setCreatingNew(true);
                    setEditingProfileId(null);
                    setName('');
                    setAvatarEmoji('🍿');
                    setAvatarColor('#ea580c');
                    setIsKids(false);
                    setMaxAgeRating('all');
                    setPinInput('');
                    setClearPin(false);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-[#1a242e]/40 hover:bg-[#1a242e] py-3.5 text-xs font-extrabold text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-[#4CAF50]" />
                  <span>إضافة ملف مشاهد جديد</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
