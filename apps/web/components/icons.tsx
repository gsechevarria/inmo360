// Iconos SVG propios (trazo 1.75, 20 px). Decorativos: aria-hidden; el texto acompaña siempre.
type P = { className?: string };
const S = ({ children, className }: P & { children: React.ReactNode }) => (
  <svg aria-hidden viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>
);
export const IconMap = (p: P) => <S {...p}><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></S>;
export const IconHome = (p: P) => <S {...p}><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></S>;
export const IconCompare = (p: P) => <S {...p}><path d="M4 6h7v12H4zM13 10h7v8h-7z" /></S>;
export const IconCalc = (p: P) => <S {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h4" /></S>;
export const IconStar = (p: P) => <S {...p}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" /></S>;
export const IconSearch = (p: P) => <S {...p}><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></S>;
export const IconImport = (p: P) => <S {...p}><path d="M12 3v12m0 0-4-4m4 4 4-4" /><path d="M4 17v3h16v-3" /></S>;
export const IconBook = (p: P) => <S {...p}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></S>;
export const IconSliders = (p: P) => <S {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></S>;
export const IconBookmark = (p: P) => <S {...p}><path d="M6 3h12v18l-6-4-6 4V3Z" /></S>;
export const IconChevron = (p: P) => <S {...p}><path d="m9 6 6 6-6 6" /></S>;
export const IconClose = (p: P) => <S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>;
export const IconExternal = (p: P) => <S {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></S>;
export const IconInfo = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></S>;
export const IconWarn = (p: P) => <S {...p}><path d="M12 4 2 20h20L12 4Z" /><path d="M12 10v4M12 17h.01" /></S>;
export const IconCheck = (p: P) => <S {...p}><path d="m5 12 4 4L19 6" /></S>;
export const IconDot = (p: P) => <S {...p}><circle cx="12" cy="12" r="4" fill="currentColor" /></S>;
export const IconLogout = (p: P) => <S {...p}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></S>;
export const IconList = (p: P) => <S {...p}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></S>;
export const IconLayers = (p: P) => <S {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></S>;
