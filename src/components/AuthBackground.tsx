export function AuthBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl animate-pulse-glow" />
      <div className="absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full bg-primary/8 blur-3xl animate-pulse-glow animation-delay-2000" />
      <div className="absolute top-1/3 right-1/4 h-64 w-64 rounded-full bg-airteltigo/8 blur-3xl animate-float-slow" />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(hsl(51 100% 50%) 1px, transparent 1px), linear-gradient(90deg, hsl(51 100% 50%) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <svg
        className="absolute top-[12%] left-[8%] w-16 h-16 text-primary/20 animate-float"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <path d="M8 44 Q32 20 56 44" />
        <path d="M16 44 Q32 28 48 44" />
        <path d="M24 44 Q32 36 40 44" />
        <circle cx="32" cy="48" r="3" fill="currentColor" />
      </svg>

      <svg
        className="absolute top-[20%] right-[10%] w-14 h-20 text-primary/15 animate-float-slow animation-delay-1000"
        viewBox="0 0 56 80"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="12" y="4" width="32" height="72" rx="6" />
        <line x1="24" y1="64" x2="32" y2="64" />
        <circle cx="28" cy="14" r="2" fill="currentColor" />
        <rect x="18" y="24" width="20" height="32" rx="2" fill="currentColor" opacity="0.15" />
      </svg>

      <svg
        className="absolute bottom-[25%] left-[12%] w-20 h-16 text-airteltigo/20 animate-drift"
        viewBox="0 0 80 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="8" y="16" width="48" height="36" rx="4" />
        <path d="M56 28 L72 20 L72 48 L56 40 Z" />
        <line x1="20" y1="28" x2="44" y2="28" />
        <line x1="20" y1="36" x2="36" y2="36" />
      </svg>
    </div>
  )
}
