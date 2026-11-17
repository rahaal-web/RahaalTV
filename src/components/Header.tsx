import { useState } from 'react';
import {
  BellDot,
  Bookmark,
  ChevronDown,
  CirclePlay,
  Home,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  Search,
  User as UserIcon,
  X,
} from 'lucide-react';
import { NAV_ITEMS } from '../data/catalog';
import { FALLBACK_POSTER, handlePosterError, matchesCategoryFilter, normalizeArabicText } from '../lib/mediaFilters';
import { MediaItem } from '../types/media';
import { Logo } from './Logo';

interface HeaderProps {
  catalog: MediaItem[];
  onNavigateHome: () => void;
  onSelectCategory: (category: string) => void;
  onOpenSearch: () => void;
  onOpenWatchlist: () => void;
  onOpenLogin: () => void;
  onOpenAdmin: () => void;
  onSelectMedia: (item: MediaItem) => void;
  watchlistCount: number;
  username: string | null;
  userPhoto: string | null;
  isAdmin: boolean;
  activeCategory: string;
  currentView: 'home' | 'archive' | 'single' | 'admin';
}

export function Header({
  catalog,
  onNavigateHome,
  onSelectCategory,
  onOpenSearch,
  onOpenWatchlist,
  onOpenLogin,
  onOpenAdmin,
  onSelectMedia,
  watchlistCount,
  username,
  userPhoto,
  isAdmin,
  activeCategory,
  currentView,
}: HeaderProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const markedNew = catalog.filter((i) => i.isNew);
  const latestNotifications = (markedNew.length > 0 ? markedNew : catalog).slice(0, 5);
  const countCategory = (category?: string) =>
    category ? catalog.filter((item) => matchesCategoryFilter(item, category)).length : catalog.length;

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-40 h-20 bg-[#0c1821]/92 backdrop-blur-md border-b border-white/[0.07] shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          {/* Zone 1: Brand Logo + Primary Navigation */}
          <div className="flex items-center gap-5 lg:gap-7">
            <button
              type="button"
              onClick={onNavigateHome}
              className="focus:outline-none cursor-pointer"
              aria-label="العودة إلى الرئيسية - RahaL TV"
            >
              <Logo />
            </button>

            <nav className="hidden xl:flex items-center gap-1" aria-label="التنقل الرئيسي">
              {NAV_ITEMS.map((item) => {
                const isHome = item.id === 'home' && currentView === 'home';
                const activeNorm = normalizeArabicText(activeCategory);
                const isActive =
                  isHome ||
                  (currentView === 'archive' &&
                    ((item.category && activeNorm === normalizeArabicText(item.category)) ||
                      Boolean(
                        item.subItems?.some(
                          (sub) => normalizeArabicText(sub.category) === activeNorm
                        )
                      )));
                const hasSub = Boolean(item.subItems && item.subItems.length > 0);
                const parentCount = item.category ? countCategory(item.category) : null;

                return (
                  <div
                    key={item.id}
                    className="relative"
                    onMouseEnter={() => hasSub && setOpenDropdown(item.id)}
                    onMouseLeave={() => hasSub && setOpenDropdown(null)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (item.id === 'home') {
                          onNavigateHome();
                        } else if (item.category) {
                          onSelectCategory(item.category);
                        }
                        setOpenDropdown(null);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-colors cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-[#D92321] text-white'
                          : 'text-[#b7c9ef] hover:bg-white/[0.06] hover:text-white'
                      }`}
                    >
                      <span>{item.label}</span>
                      {parentCount !== null && parentCount > 0 && (
                        <span
                          className={`font-latin rounded-md px-1.5 py-0.5 text-[10px] font-black ${
                            isActive ? 'bg-black/25 text-white' : 'bg-white/[0.07] text-[#b7c9ef]'
                          }`}
                        >
                          {parentCount}
                        </span>
                      )}
                      {hasSub && (
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform duration-200 ${
                            openDropdown === item.id ? 'rotate-180' : ''
                          }`}
                        />
                      )}
                    </button>

                    {hasSub && openDropdown === item.id && (
                      <div className="absolute right-0 top-full pt-2 w-56 z-50">
                        <div className="rounded-2xl bg-[#1a242e] border border-white/10 p-2 shadow-2xl">
                          {item.subItems!.map((sub) => {
                            const subCount = countCategory(sub.category);
                            return (
                              <button
                                key={sub.category}
                                type="button"
                                onClick={() => {
                                  onSelectCategory(sub.category);
                                  setOpenDropdown(null);
                                }}
                                className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-right text-[13px] font-semibold text-[#b7c9ef] hover:bg-[#D92321] hover:text-white transition-colors cursor-pointer"
                              >
                                <span>{sub.label}</span>
                                <span className="font-latin text-[11px] font-bold opacity-75">
                                  {subCount}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          {/* Zone 3: Action Controls (Search, Notifications, Watchlist, Dashboard, Account) */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label="بحث عن فيلم أو مسلسل"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1a242e] border border-white/10 px-3 text-sm font-semibold text-[#b7c9ef] hover:border-[#D92321]/60 hover:text-white transition-colors cursor-pointer"
            >
              <Search className="w-4 h-4 text-[#D92321]" />
              <span className="hidden 2xl:inline">بحث سريع...</span>
            </button>

            {/* Notifications Bell Popover */}
            <div className="relative hidden sm:block">
              <button
                type="button"
                onClick={() => setNotificationsOpen((prev) => !prev)}
                aria-label="أحدث الإضافات"
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a242e] border border-white/10 text-[#b7c9ef] hover:text-white hover:border-white/25 transition-colors cursor-pointer"
              >
                <BellDot className="w-4 h-4" />
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#D92321]" />
              </button>

              {notificationsOpen && (
                <div className="absolute left-0 top-full mt-2 w-80 rounded-2xl bg-[#1a242e] border border-white/10 p-3 shadow-2xl z-50">
                  <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-white/10">
                    <span className="text-xs font-extrabold text-white">أحدث الإضافات اليوم</span>
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      className="text-white/50 hover:text-white"
                      aria-label="إغلاق الإشعارات"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {latestNotifications.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onSelectMedia(item);
                          setNotificationsOpen(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl p-2 text-right hover:bg-white/[0.06] transition-colors cursor-pointer"
                      >
                        <img
                          src={item.poster || FALLBACK_POSTER}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          onError={handlePosterError}
                          className="h-12 w-9 rounded-lg object-cover shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">{item.title}</p>
                          <p className="text-[11px] text-[#b7c9ef] truncate">
                            {item.quality} • {item.year}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Watchlist Button */}
            <button
              type="button"
              onClick={onOpenWatchlist}
              aria-label="قائمتي"
              className="relative inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#1a242e] border border-white/10 px-3 text-sm font-bold text-[#b7c9ef] hover:text-white hover:border-[#4CAF50]/60 transition-colors cursor-pointer"
            >
              <CirclePlay className="w-4 h-4 text-[#4CAF50]" />
              <span className="hidden lg:inline">قائمتي</span>
              {watchlistCount > 0 && (
                <span className="font-latin inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-[#D92321] px-1.5 text-[11px] font-black text-white">
                  {watchlistCount}
                </span>
              )}
            </button>

            {/* Admin Dashboard Button */}
            <button
              type="button"
              onClick={onOpenAdmin}
              aria-label="لوحة التحكم"
              className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs sm:text-sm font-extrabold transition-colors cursor-pointer whitespace-nowrap ${
                currentView === 'admin'
                  ? 'bg-[#f9c400] border-[#f9c400] text-[#06131c]'
                  : isAdmin
                    ? 'bg-[#f9c400]/15 border-[#f9c400]/40 text-[#f9c400] hover:bg-[#f9c400] hover:text-[#06131c]'
                    : 'bg-[#1a242e] border-white/10 text-white hover:border-[#f9c400]/60'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">لوحة التحكم</span>
            </button>

            {/* Login / User Button */}
            <button
              type="button"
              onClick={onOpenLogin}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#D92321] hover:bg-[#dc0e30] px-3 sm:px-3.5 text-xs sm:text-sm font-bold text-white shadow-md transition-colors cursor-pointer whitespace-nowrap"
            >
              {userPhoto ? (
                <img
                  src={userPhoto}
                  alt={username || 'حسابي'}
                  referrerPolicy="no-referrer"
                  className="h-5 w-5 rounded-full object-cover border border-white/40"
                />
              ) : (
                <UserIcon className="w-4 h-4" />
              )}
              <span className="hidden md:inline max-w-[110px] truncate">
                {username || 'تسجيل الدخول'}
              </span>
            </button>

            {/* Mobile Hamburger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="فتح القائمة"
              className="inline-flex xl:hidden h-10 w-10 items-center justify-center rounded-xl bg-[#1a242e] border border-white/10 text-white hover:border-white/25 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Slide-Over Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex xl:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col bg-[#0c1821] border-l border-white/10 p-5 overflow-y-auto">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
              <Logo size="sm" />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white"
                aria-label="إغلاق القائمة"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onOpenAdmin();
                setMobileMenuOpen(false);
              }}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#f9c400] py-2.5 text-xs font-black text-[#06131c]"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>لوحة التحكم (الإدارة)</span>
            </button>

            <div className="space-y-3">
              {NAV_ITEMS.map((item) => (
                <div key={item.id} className="rounded-xl bg-[#1a242e]/60 p-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (item.id === 'home') onNavigateHome();
                      else if (item.category) onSelectCategory(item.category);
                      setMobileMenuOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-2 py-2 text-sm font-bold text-white"
                  >
                    <span>{item.label}</span>
                  </button>
                  {item.subItems && (
                    <div className="mt-1 grid grid-cols-2 gap-1.5 pr-2">
                      {item.subItems.map((sub) => (
                        <button
                          key={sub.category}
                          type="button"
                          onClick={() => {
                            onSelectCategory(sub.category);
                            setMobileMenuOpen(false);
                          }}
                          className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-right text-xs font-medium text-[#b7c9ef] hover:bg-[#D92321] hover:text-white"
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav Bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-[#0c1821]/95 backdrop-blur-md border-t border-white/10 py-2 sm:hidden">
        <button
          type="button"
          onClick={onNavigateHome}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-white"
        >
          <Home className="w-4 h-4 text-[#D92321]" />
          <span>الرئيسية</span>
        </button>
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-[#b7c9ef]"
        >
          <Search className="w-4 h-4" />
          <span>البحث</span>
        </button>
        <button
          type="button"
          onClick={onOpenWatchlist}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-[#b7c9ef]"
        >
          <Bookmark className="w-4 h-4 text-[#4CAF50]" />
          <span>قائمتي ({watchlistCount})</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectCategory('')}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-[#b7c9ef]"
        >
          <LayoutGrid className="w-4 h-4" />
          <span>الأقسام</span>
        </button>
        <button
          type="button"
          onClick={onOpenAdmin}
          className="flex flex-col items-center gap-1 text-[10px] font-bold text-[#f9c400]"
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>الإدارة</span>
        </button>
      </div>
    </>
  );
}
