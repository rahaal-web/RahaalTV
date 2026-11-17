interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export function Logo({ size = 'md' }: LogoProps) {
  const heightClass = size === 'lg' ? 'h-10' : size === 'sm' ? 'h-7' : 'h-8';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-[#D92321] shadow-[0_4px_16px_rgba(217,35,33,0.45)]">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-white fill-current" aria-hidden="true">
          <path d="M8 5.5v13l10-6.5-10-6.5z" />
        </svg>
      </div>
      <div className={`flex flex-col leading-none ${heightClass} justify-center`} dir="ltr">
        <span className="font-latin text-xl sm:text-2xl font-black tracking-tight text-white">
          RahaL <span className="text-[#D92321]">TV</span>
        </span>
        <span className="text-[10px] font-semibold tracking-wide text-[#b7c9ef]/80 text-right" dir="rtl">
          سينما بلا حدود
        </span>
      </div>
    </div>
  );
}
