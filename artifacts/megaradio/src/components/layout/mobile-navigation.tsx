import { useEffect, useRef, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link, useLocation } from 'wouter';
import { Home, Music, Compass, Heart, Users, User, Plus, ChevronRight, Radio, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useSeoRouting } from '@/hooks/useSeoRouting';

interface MobileNavigationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  isAuthenticated: boolean;
  authLoading: boolean;
  onAddStation: () => void;
}

/** Loaded on demand. Dialog owns focus, background scroll and Escape dismissal. */
export default function MobileNavigation({ open, onOpenChange, triggerRef, isAuthenticated, authLoading, onAddStation }: MobileNavigationProps) {
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();
  const [location] = useLocation();
  const openingStationModal = useRef(false);

  useEffect(() => {
    if (!open) return;
    // Do not leave an invisible modal/scroll lock behind at the desktop breakpoint.
    const closeOnDesktop = () => { if (window.innerWidth >= 1280) onOpenChange(false); };
    window.addEventListener('resize', closeOnDesktop);
    closeOnDesktop();
    return () => window.removeEventListener('resize', closeOnDesktop);
  }, [open, onOpenChange]);

  const links = [
    { path: '/', label: t('nav_home', 'Home'), icon: Home },
    { path: '/genres', label: t('nav_genres', 'Genres'), icon: Music },
    { path: '/request-station', label: t('modal_request_station_title', 'Request a Station'), icon: Radio },
    { path: '/recommendations', label: t('nav_for_you', 'For You'), icon: Compass },
    { path: '/users', label: t('users', 'Community'), icon: Users },
  ];
  const personalLinks = [
    { path: '/profile/favorites', label: t('nav_your_favorites', 'Your Favorites'), icon: Heart },
    { path: '/profile/settings', label: t('user_menu_profile', 'Profile'), icon: User },
  ];
  const renderLink = ({ path, label, icon: Icon }: typeof links[number]) => {
    const href = getLocalizedUrl(path);
    const currentPath = location.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    const targetPath = href.replace(/\/+$/, '') || '/';
    const active = currentPath === targetPath || (path !== '/' && currentPath.startsWith(`${targetPath}/`));
    return (
      <Link key={path} href={href} onClick={() => onOpenChange(false)} aria-current={active ? 'page' : undefined}
        className={`group flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-start text-base font-medium leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199] ${active ? 'bg-[#FF4199]/10 text-[#FF70B2]' : 'text-zinc-100 hover:bg-white/5'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-[#FF4199]/10' : 'bg-white/5 text-zinc-400 group-hover:text-white'}`}><Icon size={20} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1 break-words">{label}</span>
        <ChevronRight size={16} className="shrink-0 text-zinc-500 rtl:rotate-180" aria-hidden="true" />
      </Link>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[9998] bg-black/65" data-testid="mobile-navigation-backdrop" />
        <Dialog.Content id="mobile-navigation" aria-describedby={undefined}
          onCloseAutoFocus={event => { event.preventDefault(); if (!openingStationModal.current) triggerRef.current?.focus({ preventScroll: true }); }}
          className="fixed inset-y-0 start-0 z-[9999] flex w-[calc(100%_-_1.25rem)] max-w-sm flex-col border-e border-white/10 bg-[#111113] text-white shadow-2xl outline-none"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <Dialog.Title className="flex min-w-0 items-center gap-2.5 text-xl tracking-tight">
              <img src="/header-logo-80w.webp" alt="" width={36} height={36} className="h-9 w-9 object-contain" />
              <span><strong className="font-bold">mega</strong><span className="font-normal">radio</span></span>
              <span className="sr-only">{t('nav_menu', 'Menu')}</span>
            </Dialog.Title>
            <Dialog.Close className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]" aria-label={t('nav_close', 'Close')}>
              <X size={21} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <nav aria-label={t('nav_menu', 'Menu')} className="space-y-1">{links.map(renderLink)}</nav>
            <div className="mt-4 border-t border-white/10 pt-4">
              {authLoading ? <div role="status" aria-label={t('loading', 'Loading')} className="h-28 rounded-xl bg-white/5 motion-safe:animate-pulse" /> : isAuthenticated ? (
                <nav aria-label={t('nav_profile_menu', 'Profile menu')} className="space-y-1">{personalLinks.map(renderLink)}</nav>
              ) : (
                <div className="grid gap-2 px-1">
                  <Link href={`${getLocalizedUrl('/login')}?returnTo=${encodeURIComponent(location)}`} onClick={() => onOpenChange(false)} className="flex min-h-12 items-center justify-center rounded-xl bg-[#D82C80] px-4 py-3 text-center font-semibold text-white hover:bg-[#C32470] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF70B2]">{t('nav_login', 'Log in')}</Link>
                  <Link href={getLocalizedUrl('/signup')} onClick={() => onOpenChange(false)} className="flex min-h-12 items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-center font-medium text-zinc-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]">{t('nav_signup', 'Sign up')}</Link>
                </div>
              )}
            </div>
            <button type="button" onClick={() => { openingStationModal.current = true; onAddStation(); }} className="mt-5 flex min-h-12 w-full items-center gap-3 rounded-xl border border-white/15 px-4 py-3 text-start text-sm font-medium text-zinc-300 hover:border-[#FF4199]/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4199]">
              <Plus size={18} className="shrink-0 text-[#FF70B2]" aria-hidden="true" />
              <span className="min-w-0 break-words">{t('nav_add_your_station', 'Add your station')}</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
