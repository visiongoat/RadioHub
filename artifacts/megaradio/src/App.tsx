import React, { Component, type ReactNode } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";

// ─── Page Error Boundary ─────────────────────────────────────────────────────
// Catches render errors in page components and shows a friendly fallback
// instead of crashing the entire app (prevents React error #426 white screen)
class PageErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) {
    console.error("[PageErrorBoundary]", error);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="min-h-screen bg-[#0E0E0E] flex items-center justify-center">
          <div className="text-center text-white">
            <p className="text-gray-400 text-sm mt-2">Something went wrong. Please refresh the page.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { queryClient } from "./lib/queryClient";
import { hasProfileContentBreadcrumbs } from '@/lib/profile-layout';
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
// Toaster moved to a `lazy(() => ...)` declaration further below so the
// Radix toast primitives don't land in the entry chunk.
import NotificationContainer from "@/components/ui/NotificationContainer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/lib/theme-provider";
import { TranslationPreloader } from "@/components/translation/TranslationPreloader";
import { RecommendationsPrefetcher } from "@/components/recommendations/RecommendationsPrefetcher";
import { PushNotificationBridge } from "@/components/PushNotificationBridge";
import { useState, useEffect, useDeferredValue } from "react";
import { useLocation } from "wouter";
import { usePaymentSafeLocation } from '@/lib/payment-link-navigation';
import { PaymentLinkDocument } from '@/components/PaymentLinkDocument';
import { getLanguageFromPath, getRetiredLocaleFromPath } from "@workspace/seo-shared/seo-config";
import { getLegacyStationGuideRoute } from '@workspace/seo-shared/legacy-station-guide-routes';
import { syncDocumentLocale } from '@/lib/document-locale';
import { useScrollToTop } from "@/hooks/useScrollToTop";
import { useAnalytics } from "./hooks/use-analytics";
import { logger } from '@/lib/logger';
// Lazy load all route pages for optimal performance (reduces initial bundle from 1.8MB to <100KB)
import * as LazyRoutes from "@/components/lazy-routes";
import * as LazyAdminRoutes from "@/components/lazy-admin-routes";

// Keep these imports - they're small and used across many routes
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import { AdminPageErrorBoundary } from '@/components/admin/AdminPageErrorBoundary';
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer.shell";
import { LazyGlobalPlayerProvider } from "@/hooks/LazyGlobalPlayerProvider";

// Import Suspense for lazy loading boundaries
import { Suspense, lazy } from "react";

// 🚀 LAZY LOAD: GlobalPlayer - Only needed when user clicks play (not on initial page load)
const GlobalPlayer = lazy(() => import("@/components/global-player"));

// 🚀 INTERACTION-GATED: GlobalPlayer only renders after user has started playing audio
// This prevents the chunk from loading until the first play interaction
function InteractionGatedGlobalPlayer() {
  const { currentStation } = useGlobalPlayer();
  
  // Only render (and thus load the chunk) when there's a station to play
  // The GlobalPlayer component internally returns null if no station, but this gate
  // prevents even the lazy chunk from being requested until needed
  if (!currentStation) return null;
  
  return (
    <Suspense fallback={null}>
      <GlobalPlayer />
    </Suspense>
  );
}

// 🚀 LAZY LOAD: Admin/Profile components - Only for authenticated users
const ProfileLayout = lazy(() => import("@/components/layout/ProfileLayout"));
const Sidebar = lazy(() => import("@/components/layout/sidebar"));
const Header = lazy(() => import("@/components/layout/header"));

// Lazy load Footer and RadioHeader - they're below the fold and not needed for FCP
const Footer = lazy(() => import("@/components/layout/footer"));
import { RadioHeader } from '@/lib/initial-home-components';

// Minimal fallback for header during load - matches reference: 70px mobile, 90px desktop
const RadioHeaderFallback = () => (
  <nav className="fixed top-0 left-0 right-0 z-40 w-full text-white">
    <div className="flex items-center justify-center h-[70px] lg:h-[90px] border-b border-gray-900 bg-[#0E0E0E] sm:border-0">
      <div className="w-full max-w-[1512px] mx-auto h-[70px] lg:h-[90px] px-4 sm:px-6 md:px-8 lg:px-[30px] xl:px-[50px]" />
    </div>
  </nav>
);

// Minimal fallback for footer (can be empty since it's at bottom)
const FooterFallback = () => <div className="h-[200px] bg-[#0E0E0E]" />;

// 🚀 LAZY: ProfileLayout wrapper with Suspense - prevents profile components from loading for anonymous users
const ProfileLayoutFallback = () => <div className="min-h-screen bg-[#0E0E0E]" />;
const LazyProfileLayout = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<ProfileLayoutFallback />}>
    <ProfileLayout>{children}</ProfileLayout>
  </Suspense>
);

import { SeoPageWrapper } from "@/components/SeoPageWrapper";
import { BreadcrumbOverrideProvider, RouteBreadcrumbs } from "@/components/RouteBreadcrumbs";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { TranslationProvider, useTranslation } from "@/hooks/useTranslation";
import { FavoriteStateProvider } from "@/hooks/useFavoriteState";
import { COUNTRY_TO_CODE } from "@workspace/seo-shared/seo-config";
import { getSeoRouteCandidates } from '@/lib/seo-route-candidates';
import { isStationDirectoryPath } from '@workspace/seo-shared/station-directory';

import { URL_TRANSLATIONS } from "@workspace/seo-shared/url-translations";

// 🚀 LAZY: Modal only loads when user clicks "Add your station" — saves
// ~120 KB raw + Radix Select/Input deps from the entry chunk.
const AddYourStationModal = lazy(() => import("@/components/modals/AddYourStationModal"));
import StructuredData from "@/components/seo/StructuredData";

import { LazyToaster } from '@/components/LazyToaster';
import { initializeBackgroundPlayback } from "@/lib/backgroundAudio";

// Module-level constant (outside any component) — prevents useEffect from firing on every render
const CODE_TO_COUNTRY: { [key: string]: string } = {};
Object.entries(COUNTRY_TO_CODE).forEach(([country, code]) => {
  if (!CODE_TO_COUNTRY[code]) CODE_TO_COUNTRY[code] = country;
});

function AdminRouterContent() {
  const [adminLocation] = useLocation();
  return (
    <AdminPageErrorBoundary key={adminLocation.split('?')[0]}>
    <Suspense fallback={<div role="status" className="flex items-center justify-center min-h-[40vh] bg-background text-foreground"><div className="text-lg">Loading admin page…</div></div>}>
      <Switch>
        <Route path="/admin/dashboard" component={LazyAdminRoutes.AdminDashboard} />
        <Route path="/admin">
          <Redirect to="/admin/dashboard" />
        </Route>
        
        {/* Station Management - Working Pages Only */}
        <Route path="/admin/stations" component={LazyAdminRoutes.Stations} />
        <Route path="/admin/station-slugs" component={LazyAdminRoutes.AdminStationSlugs} />

        <Route path="/admin/duplicates" component={LazyAdminRoutes.AdminDuplicates} />
        <Route path="/admin/cities" component={LazyAdminRoutes.AdminCities} />
        <Route path="/admin/performance" component={LazyAdminRoutes.AdminPerformance} />
        
        {/* Content Management - Working Pages Only */}
        <Route path="/admin/genres" component={LazyAdminRoutes.AdminGenresPage} />
        <Route path="/admin/genre-whitelist" component={LazyAdminRoutes.AdminGenreWhitelist} />
        <Route path="/admin/genre-slug-cleanup" component={LazyAdminRoutes.AdminGenreSlugCleanup} />
        <Route path="/admin/codecs" component={LazyAdminRoutes.Codecs} />
        
        {/* Radio Browser API - Working Pages Only */}
        <Route path="/admin/sync" component={LazyAdminRoutes.SyncStatus} />
        <Route path="/admin/radio-browser" component={LazyAdminRoutes.RadioBrowser} />
        
        {/* Analytics & Reports - Working Pages Only */}
        <Route path="/admin/analytics" component={LazyAdminRoutes.Analytics} />
        <Route path="/admin/feedback" component={LazyAdminRoutes.AdminFeedback} />
        <Route path="/admin/status-monitoring" component={LazyAdminRoutes.StatusMonitoring} />
        
        {/* System - Working Pages Only */}
        <Route path="/admin/settings" component={LazyAdminRoutes.Settings} />
        
        {/* Translation Management */}
        <Route path="/admin/translations" component={LazyAdminRoutes.AdminTranslations} />
        <Route path="/admin/translation-languages" component={LazyAdminRoutes.AdminTranslationLanguages} />
        <Route path="/admin/country-language-mappings" component={LazyAdminRoutes.AdminCountryLanguageMappings} />
        <Route path="/admin/url-translations" component={LazyAdminRoutes.AdminUrlTranslations} />
        
        {/* Home & Homepage Management */}
        <Route path="/admin/home-settings" component={LazyAdminRoutes.HomeSettings} />
        <Route path="/admin/db-management" component={LazyAdminRoutes.DbManagement} />

        {/* Content & Media Management */}
        <Route path="/admin/advertisements" component={LazyAdminRoutes.Advertisements} />
        <Route path="/admin/footer-social-media" component={LazyAdminRoutes.FooterSocialMedia} />
        <Route path="/admin/logos" component={LazyAdminRoutes.LogoManagement} />
        
        {/* Payment Gateway */}
        <Route path="/admin/stripe-plans" component={LazyAdminRoutes.StripePlans} />
        <Route path="/admin/paddle-plans" component={LazyAdminRoutes.PaddlePlans} />

        {/* Developer API */}
        <Route path="/admin/api-keys" component={LazyAdminRoutes.AdminApiKeys} />
        <Route path="/admin/sales" component={LazyAdminRoutes.SalesAnalytics} />

        {/* Users Management */}
        <Route path="/admin/users" component={LazyAdminRoutes.AdminUsers} />
        <Route path="/admin/iap-events" component={LazyAdminRoutes.AdminIapEvents} />
        <Route path="/admin/seo-maintenance" component={LazyAdminRoutes.AdminSeoMaintenance} />
        <Route path="/admin/seo-maintenance/runs/:id" component={LazyAdminRoutes.AdminSeoMaintenanceRun} />
        <Route path="/admin/seo-translations" component={LazyAdminRoutes.SeoTranslationsHub} />
        <Route path="/admin/semrush" component={LazyAdminRoutes.SemrushIssues} />
        <Route path="/admin/tv-version" component={LazyAdminRoutes.TvVersion} />
        <Route path="/admin/coverage" component={LazyAdminRoutes.AdminCoverage} />
        <Route path="/admin/coverage/compare" component={LazyAdminRoutes.AdminCoverageCompare} />
        <Route path="/admin/coverage/:countryCode" component={LazyAdminRoutes.AdminCoverageCountry} />
        
        {/* SEO Tools */}
        <Route path="/admin/seo-preview" component={LazyAdminRoutes.AdminSeoPreview} />
        <Route path="/admin/indexnow" component={LazyAdminRoutes.IndexNowMonitoring} />
        <Route path="/admin/gsc-inspection" component={LazyAdminRoutes.GscInspection} />
        
        {/* Error Monitoring */}
        <Route path="/admin/error-logs" component={LazyAdminRoutes.AdminErrorLogs} />
        <Route path="/admin/app-logs" component={LazyAdminRoutes.AdminAppLogs} />
        <Route path="/admin/tv-diagnostics" component={LazyAdminRoutes.TvDiagnostics} />

        
        <Route component={LazyRoutes.NotFound} />
      </Switch>
    </Suspense>
    </AdminPageErrorBoundary>
  );
}

export function PublicRouter({ selectedCountry, onCountryChange }: { selectedCountry?: string; onCountryChange?: (country: string, isManual?: boolean) => void }) {
  const { cleanPath, englishPath, currentLanguage } = useSeoRouting();
  const [location, setLocation] = useLocation();

  // React 18 useDeferredValue: keeps the previous route visible while the next
  // lazy chunk is loading — prevents "suspended during synchronous input" warning.
  // On navigation: englishPath changes immediately, deferredPath stays at the old
  // value until the new component is ready (Suspense-safe transition).
  const deferredPath = useDeferredValue(englishPath);

  // CRITICAL FIX: Route based on englishPath, not cleanPath
  // cleanPath can be in translated language (e.g., "/zhanret"), but router needs English (e.g., "/genres")
  const renderByCleanPath = () => {
    // CRITICAL FIX: Strip query params and hash for route matching
    // GenresPage adds ?page=1 which would break the equality check
    const pathToUse = deferredPath.split('?')[0].split('#')[0];
    if (getLegacyStationGuideRoute(location)) return <LazyRoutes.LegacyStationGuidePage />;
    
    
    if (pathToUse === '/') return <LazyRoutes.RadioFrontend selectedCountry={selectedCountry} onCountryChange={onCountryChange} />;

    if (pathToUse === '/genres') {
      logger.log('✅ RENDERING GENRES PAGE');
      return <LazyRoutes.GenresPage selectedCountry={selectedCountry} onCountryChange={onCountryChange} />;
    }
    if (pathToUse.startsWith('/genres/')) {
      // Check if it's a genre landing page (slug format)
      const slug = pathToUse.split('/genres/')[1];
      if (slug && !slug.includes('/')) {
        return <LazyRoutes.GenreLanding selectedCountry={selectedCountry} onCountryChange={onCountryChange} />;
      }
      return <LazyRoutes.GenreDetail selectedCountry={selectedCountry} onCountryChange={onCountryChange} />;
    }
    if (pathToUse === '/about') return <LazyRoutes.About />;
    if (pathToUse === '/contact') return <LazyRoutes.Contact />;
    if (pathToUse === '/feedback') return <LazyRoutes.PublicFeedback />;
    if (pathToUse === '/llms') return <LazyRoutes.LLMsPage />;
    if (pathToUse === '/blog' || pathToUse.startsWith('/blog/')) return <LazyRoutes.BlogPage />;

    if (pathToUse === '/applications') return <LazyRoutes.Applications />;
    if (pathToUse === '/search') return <LazyRoutes.SearchPage />;
    if (pathToUse === '/faq') return <LazyRoutes.FaqPage />;
    if (pathToUse === '/terms-and-conditions' || pathToUse === '/pages/terms-and-conditions') return <LazyRoutes.TermsAndConditions />;
    if (pathToUse === '/login') return <LazyRoutes.Login />;
    if (pathToUse === '/signup') return <LazyRoutes.Signup />;
    if (pathToUse === '/forgot-password') return <LazyRoutes.ForgotPassword />;
    if (pathToUse === '/reset-password') return <LazyRoutes.ResetPassword />;
    if (pathToUse === '/auth/login') return <LazyRoutes.LoginPage />;
    if (pathToUse === '/auth/signup') return <LazyRoutes.SignupPage />;
    if (pathToUse === '/auth/forgot-password') return <LazyRoutes.ForgotPasswordPage />;
    if (pathToUse === '/radios') return <LazyRoutes.Radios selectedCountry={selectedCountry} onCountryChange={onCountryChange} />;
    if (pathToUse === '/change-password') return <LazyRoutes.ChangePassword />;
    
    // CRITICAL FIX: User profile routing - handle BOTH English and translated paths
    // Support Unicode characters in URLs (e.g., /përdoruesit/ for Albanian)
    if (pathToUse === '/users') return <LazyRoutes.UsersIndex />;
    if (pathToUse.match(/^\/users\/[^\/]+$/)) return <LazyRoutes.UserProfilePage />;
    if (pathToUse.startsWith('/users/')) return <LazyRoutes.UserProfile />;
    
    // Profile routes - protected pages
    if (pathToUse === '/profile/favorites') {
      return (
        <ProtectedRoute>
          <LazyProfileLayout>
            <LazyRoutes.Favorites />
          </LazyProfileLayout>
        </ProtectedRoute>
      );
    }
    if (pathToUse === '/profile/discover') {
      return (
        <ProtectedRoute>
          <LazyProfileLayout>
            <LazyRoutes.ProfileDiscover />
          </LazyProfileLayout>
        </ProtectedRoute>
      );
    }
    if (pathToUse === '/profile/settings') {
      return (
        <ProtectedRoute>
          <LazyProfileLayout>
            <LazyRoutes.ProfileSettings />
          </LazyProfileLayout>
        </ProtectedRoute>
      );
    }
    if (pathToUse === '/profile/followers' || pathToUse === '/profile/following') {
      return <ProtectedRoute><LazyProfileLayout>
        <LazyRoutes.ProfileConnections direction={pathToUse === '/profile/followers' ? 'followers' : 'following'} />
      </LazyProfileLayout></ProtectedRoute>;
    }
    if (pathToUse === '/profile/notifications') {
      return (
        <ProtectedRoute>
          <LazyProfileLayout>
            <LazyRoutes.NotificationsView />
          </LazyProfileLayout>
        </ProtectedRoute>
      );
    }
    if (pathToUse === '/profile/messages' || pathToUse.startsWith('/profile/messages/')) {
      return (
        <ProtectedRoute>
          <PageErrorBoundary>
            <LazyProfileLayout>
              <LazyRoutes.MessagesPage />
            </LazyProfileLayout>
          </PageErrorBoundary>
        </ProtectedRoute>
      );
    }
    if (pathToUse === '/profile' || pathToUse === '/profile/') return <LazyRoutes.ProfileRedirect />;

    if (pathToUse === '/tv') return <LazyRoutes.TvLogin />;
    if (pathToUse === '/activate/success') return <LazyRoutes.ActivateSuccessPage />;
    if (pathToUse === '/activate') return <LazyRoutes.ActivatePage />;
    if (pathToUse === '/premium/success') return <LazyRoutes.PremiumSuccessPage />;
    if (pathToUse === '/premium') return <LazyRoutes.PremiumPage />;
    if (pathToUse === '/trending') return <LazyRoutes.TrendingStations />;
    if (pathToUse === '/test-user') return <div className="min-h-screen bg-[#0E0E0E] text-white flex items-center justify-center"><h1 className="text-2xl">Test Route Works!</h1></div>;
    if (pathToUse === '/request-station') return <LazyRoutes.RequestStation />;
    if (pathToUse === '/recommendations') return <LazyRoutes.RecommendationsPage selectedCountry={selectedCountry} onCountryChange={onCountryChange} />;
    if (pathToUse === '/privacy-policy' || pathToUse === '/pages/privacy-policy') return <LazyRoutes.PrivacyPolicy />;
    if (pathToUse === '/notifications') return <LazyRoutes.NotificationSettings />;
    // Regions routing system - TuneIn style navigation
    if (pathToUse === '/regions') return <LazyRoutes.RegionsPage />;
    if (pathToUse.match(/^\/regions\/[^\/]+$/) && !pathToUse.includes('/stations')) return <LazyRoutes.RegionCountriesPage />;
    if (pathToUse.match(/^\/regions\/[^\/]+\/[^\/]+$/) && !pathToUse.includes('/stations')) return <LazyRoutes.CountryCitiesPage />;
    if (pathToUse.match(/^\/regions\/[^\/]+\/[^\/]+\/stations$/)) return <LazyRoutes.RegionStationsPage />;
    if (pathToUse.match(/^\/regions\/[^\/]+\/[^\/]+\/[^\/]+\/stations$/)) return <LazyRoutes.RegionStationsPage />;
    
    // Austria radios with URL parameter support like GitHub example
    if (pathToUse === '/radios/austria') return <LazyRoutes.AustriaRadiosPage />;

    // Match the wrapper's server-backed catalog before station detail routes.
    if (isStationDirectoryPath(pathToUse, !getRetiredLocaleFromPath(location))) return <LazyRoutes.StationDirectory />;

    // CRITICAL FIX: Station routing - handle BOTH English and translated paths
    // Support both /station/ and /stations/ formats without redirect (avoids losing country code)
    if (pathToUse.startsWith('/station/')) return <LazyRoutes.StationDetails />;
    if (pathToUse.startsWith('/stations/')) return <LazyRoutes.StationDetails />;
    
    return <LazyRoutes.NotFound />;
  };

  // CRITICAL FIX: Wrap all lazy-loaded components in Suspense to prevent React error #426 (white screen bug)
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[#0E0E0E] text-white">
        <div className="text-lg">Loading...</div>
      </div>
    }>
      {renderByCleanPath()}
    </Suspense>
  );
}


function PlayerWrapper() {
  const [showAddStationModal, setShowAddStationModal] = useState(false);
  const { cleanPath, englishPath, changeLanguage, currentLanguage } = useSeoRouting();
  const { setLanguage: setTranslationLanguage } = useTranslation();
  const [, setLocation] = useLocation();
  
  // Use getLanguageForCountry helper from @shared/seo-config (single source of truth)
  
  // Initialize country state from localStorage only (independent from language)
  const [selectedCountry, setSelectedCountry] = useState(() => {
    try {
      // Get saved country preference from localStorage
      const stored = localStorage.getItem('selectedCountry');
      return stored || "all";
    } catch {
      return "all";
    }
  });

  // Track dropdown override state to prevent URL-based country changes
  const [dropdownOverride, setDropdownOverride] = useState(false);

  // Update selected country when URL changes 
  useEffect(() => {
    logger.log('🔍 Country detection useEffect running...', { cleanPath, dropdownOverride, selectedCountry });
    
    // Don't auto-update country if user has manually selected one
    if (dropdownOverride) {
      logger.log('🔒 Dropdown override active - skipping URL-based country detection');
      return;
    }
    
    const currentPath = window.location.pathname;
    // Also match paths like /tr (not just /tr/)
    const match = currentPath.match(/^\/([a-z]{2})(?:\/|$)/);
    
    logger.log('🌍 URL analysis:', { currentPath, match: match?.[1], codeToCountry: match ? CODE_TO_COUNTRY[match[1]] : 'no match' });
    
    if (match) {
      const urlCode = match[1];  // This is a LANGUAGE code in URL (tr, de, en, ar, etc.)
      // NEW ARCHITECTURE: URL code = language, NOT country
      // Country is stored in localStorage/cookie separately
      logger.log(`🌍 Detected URL language code: /${urlCode}/`);
      
      // Don't auto-update selectedCountry from URL - country is a separate filter
      // Only use localStorage-stored country preference
      const storedCountry = localStorage.getItem('selectedCountry');
      if (storedCountry && storedCountry !== selectedCountry) {
        logger.log(`🔄 Restoring country preference from localStorage: ${storedCountry}`);
        setSelectedCountry(storedCountry);
      } else if (!storedCountry && selectedCountry !== "all") {
        // No stored preference, default to "all"
        logger.log(`🌐 No stored country preference, using "all"`);
        setSelectedCountry("all");
      }
    } else if (selectedCountry !== "all") {
      // No URL code in path, restore from localStorage or reset to "all"
      const storedCountry = localStorage.getItem('selectedCountry');
      if (storedCountry) {
        logger.log(`🔄 Restoring country preference: ${storedCountry}`);
        setSelectedCountry(storedCountry);
      } else {
        logger.log(`🌐 No URL code in URL (${currentPath}), resetting to "all"`);
        setSelectedCountry("all");
      }
    }
  }, [cleanPath, dropdownOverride, selectedCountry]);

  const handleCountryChange = (country: string, isManual: boolean = true) => {
    logger.log(`🎯 handleCountryChange called: ${selectedCountry} -> ${country} (${isManual ? 'manual' : 'automatic'})`);
    
    // Set dropdown override flag for manual selections
    if (isManual) {
      logger.log('🔒 Setting dropdown override to prevent URL auto-updates');
      setDropdownOverride(true);
    }
    
    // Update state - this triggers content filtering in child components
    setSelectedCountry(country);
    
    // NEW ARCHITECTURE: Country selection is just a content filter, NOT a URL change
    // User's language preference (URL slug) stays unchanged
    // This follows YouTube/Spotify pattern where country ≠ language
    
    // Persist to localStorage for persistence across page loads
    try {
      localStorage.setItem('selectedCountry', country);
      if (isManual) {
        localStorage.setItem('countryPreference', 'manual'); // Mark as manual selection
      }
    } catch (error) {
      // Silently fail for localStorage errors
    }
    
    logger.log(`✅ Country filter updated to: ${country} (URL unchanged, language preserved)`);
  };


  
  // Determine page type for SEO
  const getPageType = () => {
    if (cleanPath === '/') return 'home';
    if (cleanPath.startsWith('/genres')) return 'genres';
    if (cleanPath.startsWith('/stations')) return 'stations';
    if (cleanPath.startsWith('/about')) return 'about';
    return 'general';
  };

  // Reference: Profile pages do NOT have footer (user.vue layout)
  const isProfilePage = englishPath === '/profile' || englishPath.startsWith('/profile/');
  const isTvPairingPage = englishPath === '/tv';
  const isTvPurchasePage = englishPath === '/activate' || englishPath === '/activate/success';
  const isStandaloneTvFlow = isTvPairingPage || isTvPurchasePage;
  const isMessagesPage = englishPath === '/profile/messages' || englishPath.startsWith('/profile/messages/');

  return (
    <SeoPageWrapper pageType={getPageType()}>
      <BreadcrumbOverrideProvider>
      <div className={`${isMessagesPage ? 'h-[100dvh] min-h-0 overflow-hidden' : 'min-h-screen overflow-x-hidden'} bg-[#0E0E0E] radio-theme flex flex-col w-full`}>
        {/* Header with centered content - header itself is full-width for background */}
        {!isStandaloneTvFlow && <Suspense fallback={<RadioHeaderFallback />}>
          <RadioHeader 
            profileLayout={isProfilePage}
            showAddStationModal={showAddStationModal}
            setShowAddStationModal={setShowAddStationModal}
            selectedCountry={selectedCountry}
            onCountryChange={handleCountryChange}
          />
        </Suspense>}
        {/* Main content area - pages handle their own max-width for full-bleed hero support */}
        <main className={`${isStandaloneTvFlow ? '' : 'pt-[70px] md:pt-[80px] lg:pt-[90px] xl:pt-[105px]'} flex-1 w-full ${isMessagesPage ? 'box-border min-h-0 overflow-hidden' : ''}`}>
          {/* Task #371: visible breadcrumb trail on every non-home page —
              client-side counterpart to the SSR breadcrumb in
              api-server/seo-renderer.ts so the BreadcrumbList JSON-LD always
              has matching visible links post-hydration. */}
          {!isMessagesPage && !isStandaloneTvFlow && !hasProfileContentBreadcrumbs(englishPath) && <RouteBreadcrumbs />}
          <PublicRouter selectedCountry={selectedCountry} onCountryChange={handleCountryChange} />
        </main>
        {/* Footer - hidden on profile pages per reference (user.vue has no footer) */}
        {!isProfilePage && !isStandaloneTvFlow && (
          <div className="w-full">
            <Suspense fallback={<FooterFallback />}>
              <Footer />
            </Suspense>
          </div>
        )}
        {/* 🚀 INTERACTION-GATED: Player chunk only loads after first play */}
        <InteractionGatedGlobalPlayer />
        
        {/* Modal Components — lazy-loaded so the chunk only fetches on first open */}
        {showAddStationModal && (
          <Suspense fallback={null}>
            <AddYourStationModal 
              isOpen={showAddStationModal} 
              onClose={() => setShowAddStationModal(false)} 
            />
          </Suspense>
        )}
        
        {/* Notification System */}
        <NotificationContainer position="top-right" />
      </div>
      </BreadcrumbOverrideProvider>
    </SeoPageWrapper>
  );
}

function ApplicationsWrapper() {
  const [showAddStationModal, setShowAddStationModal] = useState(false);
  const [showRequestStationModal, setShowRequestStationModal] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState("all");
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const handleCountryChange = (country: string, isManual: boolean = true) => {
    setSelectedCountry(country);
  };

  // Geolocation detection - same as RadioFrontend
  // OPTIMIZED: Use cached location data from localStorage
  const { data: locationData } = useQuery({
    queryKey: ['/api/location'],
    initialData: () => {
      try {
        const cached = localStorage.getItem('cachedLocationData');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.timestamp && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
            return parsed.data;
          }
        }
      } catch {}
      return undefined;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
  });

  // Auto-set country based on user location on initial load
  useEffect(() => {
    if ((locationData as any)?.location?.country && 
        (locationData as any)?.location?.country !== 'all' && 
        selectedCountry === 'all' && 
        !initialLoadDone) {
      const detectedCountry = (locationData as any).location.country;
      setSelectedCountry(detectedCountry);
      setInitialLoadDone(true);
    } else if (locationData && !initialLoadDone) {
      setInitialLoadDone(true);
    }
  }, [locationData, selectedCountry, initialLoadDone]);

  return (
    <SeoPageWrapper>
      <BreadcrumbOverrideProvider>
      <div className="min-h-screen bg-[#0E0E0E] radio-theme flex flex-col w-full overflow-x-hidden">
        {/* Header with centered content */}
        <Suspense fallback={<RadioHeaderFallback />}>
          <RadioHeader 
            showAddStationModal={showAddStationModal}
            setShowAddStationModal={setShowAddStationModal}
            selectedCountry={selectedCountry}
            onCountryChange={handleCountryChange}
          />
        </Suspense>
        {/* Main content area */}
        <main className="pt-[70px] md:pt-[80px] lg:pt-[90px] xl:pt-[105px] flex-1 w-full">
          {/* Task #371: same SSR-matching breadcrumb as the main public layout. */}
          <RouteBreadcrumbs />
          <Suspense fallback={<div className="min-h-screen bg-[#0E0E0E]" />}>
            <LazyRoutes.Applications />
          </Suspense>
        </main>
        {/* Footer */}
        <div className="w-full">
          <Suspense fallback={<FooterFallback />}>
            <Footer />
          </Suspense>
        </div>
        {/* 🚀 INTERACTION-GATED: Player chunk only loads after first play */}
        <InteractionGatedGlobalPlayer />
        
        {/* Modal Components — lazy-loaded so the chunk only fetches on first open */}
        {showAddStationModal && (
          <Suspense fallback={null}>
            <AddYourStationModal 
              isOpen={showAddStationModal} 
              onClose={() => setShowAddStationModal(false)} 
            />
          </Suspense>
        )}
        
        {/* Notification System */}
        <NotificationContainer position="top-right" />
      </div>
      </BreadcrumbOverrideProvider>
    </SeoPageWrapper>
  );
}

export const SeoMainRouter = React.memo(() => {
  const [location] = useLocation();
  // JSX is constructed before Switch picks a match. Building every country's
  // translated routes here allocated thousands of elements on each navigation.
  const { languages, countries } = getSeoRouteCandidates(location);
  
  return (
    <Switch>
      <Route path="/pay" component={PaymentLinkDocument} />
      {/* API Documentation - standalone page without header/footer */}
      <Route path="/api-docs/:category?">
        <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0a14", color: "#fff" }}>Loading API Docs...</div>}>
          <LazyRoutes.ApiDocs />
        </Suspense>
      </Route>

      {/* API User Dashboard - standalone page without header/footer */}
      <Route path="/api-user">
        <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0a14", color: "#fff" }}>Loading Developer Portal...</div>}>
          <LazyRoutes.ApiUser />
        </Suspense>
      </Route>

      {/* Admin routes - MUST come FIRST before any wildcard routes */}
      <Route path="/admin/login" component={LazyRoutes.AdminLogin} />
      <Route path="/admin-login" component={LazyRoutes.AdminLogin} />
      <Route path="/admin/*" component={AdminLayout} />
      <Route path="/notifications" component={PlayerWrapper} />

      {/* Profile routes - MUST come before wildcard routes */}
      <Route path="/profile" component={PlayerWrapper} />
      <Route path="/profile/:subpage" component={PlayerWrapper} />

      {/* Regions routes - TuneIn style navigation */}
      <Route path="/regions" component={PlayerWrapper} />
      <Route path="/regions/:regionSlug" component={PlayerWrapper} />
      <Route path="/regions/:regionSlug/:countrySlug" component={PlayerWrapper} />
      <Route path="/regions/:regionSlug/:countrySlug/:citySlug?/stations" component={PlayerWrapper} />

      {/* Language-specific routes - ALL enabled languages */}
      {languages.map(langConfig => (
        <React.Fragment key={`${langConfig.code}-routes`}>
          <Route path={`/${langConfig.code}`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/genres`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/genres/:slug`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/about`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/contact`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/feedback`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/llms`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/terms-and-conditions`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/login`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/signup`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/forgot-password`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/radios`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/station/:slug`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/stations/:id`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/users/:id`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/users`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/request-station`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/recommendations`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/tv`} component={PlayerWrapper} />
          
          {/* TRANSLATED URL ROUTES - Programmatically generated for ALL 37 languages */}
          {(() => {
            const translations = URL_TRANSLATIONS[langConfig.code];
            if (!translations) return null;
            
            return (
              <>
                {/* Simple page routes with translated paths */}
                {translations['recommendations'] && (
                  <Route path={`/${langConfig.code}/${translations['recommendations']}`} component={PlayerWrapper} />
                )}
                {translations['genres'] && (
                  <>
                    <Route path={`/${langConfig.code}/${translations['genres']}`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['genres']}/:slug`} component={PlayerWrapper} />
                  </>
                )}
                {translations['station'] && (
                  <Route path={`/${langConfig.code}/${translations['station']}/:slug`} component={PlayerWrapper} />
                )}
                {translations['trending'] && (
                  <Route path={`/${langConfig.code}/${translations['trending']}`} component={LazyRoutes.TrendingStations} />
                )}
                {translations['favorites'] && (
                  <Route path={`/${langConfig.code}/${translations['favorites']}`} component={PlayerWrapper} />
                )}
                {translations['about'] && (
                  <Route path={`/${langConfig.code}/${translations['about']}`} component={PlayerWrapper} />
                )}
                {translations['contact'] && (
                  <Route path={`/${langConfig.code}/${translations['contact']}`} component={PlayerWrapper} />
                )}
                {translations['feedback'] && (
                  <Route path={`/${langConfig.code}/${translations['feedback']}`} component={PlayerWrapper} />
                )}
                {translations['login'] && translations['login'] !== 'login' && (
                  <Route path={`/${langConfig.code}/${translations['login']}`} component={PlayerWrapper} />
                )}
                {translations['signup'] && translations['signup'] !== 'signup' && (
                  <Route path={`/${langConfig.code}/${translations['signup']}`} component={PlayerWrapper} />
                )}
                {translations['forgot-password'] && (
                  <Route path={`/${langConfig.code}/${translations['forgot-password']}`} component={PlayerWrapper} />
                )}
                {translations['privacy-policy'] && (
                  <Route path={`/${langConfig.code}/${translations['privacy-policy']}`} component={PlayerWrapper} />
                )}
                {translations['terms-and-conditions'] && (
                  <Route path={`/${langConfig.code}/${translations['terms-and-conditions']}`} component={PlayerWrapper} />
                )}
                {translations['request-station'] && (
                  <Route path={`/${langConfig.code}/${translations['request-station']}`} component={PlayerWrapper} />
                )}
                {translations['change-password'] && (
                  <Route path={`/${langConfig.code}/${translations['change-password']}`} component={PlayerWrapper} />
                )}
                {translations['applications'] && (
                  <Route path={`/${langConfig.code}/${translations['applications']}`} component={ApplicationsWrapper} />
                )}
                {translations['radios'] && (
                  <Route path={`/${langConfig.code}/${translations['radios']}`} component={PlayerWrapper} />
                )}
                {translations['stations'] && (
                  <>
                    {/* Listing route at the canonical /lang/{stations} URL — must
                        match url-redirect-middleware STATION_LIST_ALIASES canonical. */}
                    <Route path={`/${langConfig.code}/${translations['stations']}`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['stations']}/:id`} component={PlayerWrapper} />
                  </>
                )}
                {translations['users'] && (
                  <>
                    <Route path={`/${langConfig.code}/${translations['users']}`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['users']}/:id`} component={PlayerWrapper} />
                  </>
                )}
                {/* Translated profile routes - Uses PlayerWrapper for header/footer */}
                {translations['profile'] && translations['profile'] !== 'profile' && (
                  <>
                    <Route path={`/${langConfig.code}/${translations['profile']}`} component={PlayerWrapper} />
                    {translations['favorites'] && (
                      <Route path={`/${langConfig.code}/${translations['profile']}/${translations['favorites']}`} component={PlayerWrapper} />
                    )}
                    {translations['discover'] && (
                      <Route path={`/${langConfig.code}/${translations['profile']}/${translations['discover']}`} component={PlayerWrapper} />
                    )}
                    {translations['settings'] && (
                      <Route path={`/${langConfig.code}/${translations['profile']}/${translations['settings']}`} component={PlayerWrapper} />
                    )}
                    {translations['notifications'] && (
                      <Route path={`/${langConfig.code}/${translations['profile']}/${translations['notifications']}`} component={PlayerWrapper} />
                    )}
                    {/* Messages — `messages` is not yet in URL_TRANSLATIONS, so
                        getLocalizedUrl('/profile/messages') for non-English
                        languages emits /<lang>/<translated-profile>/messages
                        (mixed). Mount that path plus a wildcard for thread
                        sub-routes like /<lang>/<translated-profile>/messages/<userId>.
                        If/when 'messages' gets a translation, the second pair
                        below covers the fully-translated form. */}
                    <Route path={`/${langConfig.code}/${translations['profile']}/followers`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['profile']}/following`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['profile']}/messages`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['profile']}/messages/:rest*`} component={PlayerWrapper} />
                    {translations['messages'] && (
                      <>
                        <Route path={`/${langConfig.code}/${translations['profile']}/${translations['messages']}`} component={PlayerWrapper} />
                        <Route path={`/${langConfig.code}/${translations['profile']}/${translations['messages']}/:rest*`} component={PlayerWrapper} />
                      </>
                    )}
                  </>
                )}
                {translations['regions'] && translations['regions'] !== 'regions' && (
                  <>
                    <Route path={`/${langConfig.code}/${translations['regions']}`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['regions']}/:regionSlug`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['regions']}/:regionSlug/:countrySlug`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['regions']}/:regionSlug/:countrySlug/:citySlug?/stations`} component={PlayerWrapper} />
                    {translations['stations'] && translations['stations'] !== 'stations' && (
                      <Route path={`/${langConfig.code}/${translations['regions']}/:regionSlug/:countrySlug/:citySlug?/${translations['stations']}`} component={PlayerWrapper} />
                    )}
                  </>
                )}
                {translations['pages'] && (
                  <>
                    <Route path={`/${langConfig.code}/${translations['pages']}/${translations['privacy-policy'] || 'privacy-policy'}`} component={PlayerWrapper} />
                    <Route path={`/${langConfig.code}/${translations['pages']}/${translations['terms-and-conditions'] || 'terms-and-conditions'}`} component={PlayerWrapper} />
                  </>
                )}
              </>
            );
          })()}
          
          <Route path={`/${langConfig.code}/privacy-policy`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/applications`} component={ApplicationsWrapper} />
          <Route path={`/${langConfig.code}/pages/privacy-policy`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/pages/terms-and-conditions`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/change-password`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/favorites`} component={PlayerWrapper} />
          
          {/* Language-specific regions routes */}
          <Route path={`/${langConfig.code}/regions`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/regions/:regionSlug`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/regions/:regionSlug/:countrySlug`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/regions/:regionSlug/:countrySlug/:citySlug?/stations`} component={PlayerWrapper} />

          <Route path={`/${langConfig.code}/trending`} component={LazyRoutes.TrendingStations} />
          
          {/* Language-specific profile routes - Uses PlayerWrapper which provides RadioHeader and Footer */}
          <Route path={`/${langConfig.code}/profile/favorites`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/profile/discover`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/profile/settings`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/profile/notifications`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/profile/followers`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/profile/following`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/profile/messages`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/profile/messages/:rest*`} component={PlayerWrapper} />
          <Route path={`/${langConfig.code}/profile`} component={PlayerWrapper} />
        </React.Fragment>
      ))}

      {/* Country code routes that map to supported languages */}
      {countries.map(([countryCode, langCode]) => {
        // Get translations for this country's language
        const translations = URL_TRANSLATIONS[langCode] || {};
        
        return (
          <React.Fragment key={`${countryCode}-country-routes`}>
            <Route path={`/${countryCode}`} component={PlayerWrapper} />
            
            {/* Genres routes - English + Translated */}
            <Route path={`/${countryCode}/genres`} component={PlayerWrapper} />
            {translations['genres'] && (
              <Route path={`/${countryCode}/${translations['genres']}`} component={PlayerWrapper} />
            )}
            <Route path={`/${countryCode}/genres/:slug`} component={PlayerWrapper} />
            {translations['genres'] && (
              <Route path={`/${countryCode}/${translations['genres']}/:slug`} component={PlayerWrapper} />
            )}
            
            {/* About - English + Translated */}
            <Route path={`/${countryCode}/about`} component={PlayerWrapper} />
            {translations['about'] && (
              <Route path={`/${countryCode}/${translations['about']}`} component={PlayerWrapper} />
            )}
            
            {/* Contact - English + Translated */}
            <Route path={`/${countryCode}/contact`} component={PlayerWrapper} />
            {translations['contact'] && (
              <Route path={`/${countryCode}/${translations['contact']}`} component={PlayerWrapper} />
            )}
            
            {/* Feedback - English + Translated */}
            <Route path={`/${countryCode}/feedback`} component={PlayerWrapper} />
            {translations['feedback'] && (
              <Route path={`/${countryCode}/${translations['feedback']}`} component={PlayerWrapper} />
            )}
            
            {/* Terms and Conditions - English + Translated */}
            <Route path={`/${countryCode}/terms-and-conditions`} component={PlayerWrapper} />
            {translations['terms-and-conditions'] && (
              <Route path={`/${countryCode}/${translations['terms-and-conditions']}`} component={PlayerWrapper} />
            )}
            
            {/* Login - English + Translated */}
            <Route path={`/${countryCode}/login`} component={PlayerWrapper} />
            {translations['login'] && (
              <Route path={`/${countryCode}/${translations['login']}`} component={PlayerWrapper} />
            )}
            
            {/* Signup - English + Translated */}
            <Route path={`/${countryCode}/signup`} component={PlayerWrapper} />
            {translations['signup'] && (
              <Route path={`/${countryCode}/${translations['signup']}`} component={PlayerWrapper} />
            )}
            
            {/* Forgot Password - English + Translated */}
            <Route path={`/${countryCode}/forgot-password`} component={PlayerWrapper} />
            {translations['forgot-password'] && (
              <Route path={`/${countryCode}/${translations['forgot-password']}`} component={PlayerWrapper} />
            )}
            
            {/* Radios - English + Translated */}
            <Route path={`/${countryCode}/radios`} component={PlayerWrapper} />
            {translations['radios'] && (
              <Route path={`/${countryCode}/${translations['radios']}`} component={PlayerWrapper} />
            )}
            
            {/* Station - English + Translated */}
            <Route path={`/${countryCode}/station/:slug`} component={PlayerWrapper} />
            {translations['station'] && (
              <Route path={`/${countryCode}/${translations['station']}/:slug`} component={PlayerWrapper} />
            )}
            
            {/* Stations - English + Translated (listing + detail) */}
            <Route path={`/${countryCode}/stations`} component={PlayerWrapper} />
            <Route path={`/${countryCode}/stations/:id`} component={PlayerWrapper} />
            {translations['stations'] && (
              <>
                <Route path={`/${countryCode}/${translations['stations']}`} component={PlayerWrapper} />
                <Route path={`/${countryCode}/${translations['stations']}/:id`} component={PlayerWrapper} />
              </>
            )}
            
            {/* Users - English + Translated */}
            <Route path={`/${countryCode}/users/:id`} component={PlayerWrapper} />
            <Route path={`/${countryCode}/users`} component={PlayerWrapper} />
            {translations['users'] && (
              <>
                <Route path={`/${countryCode}/${translations['users']}/:id`} component={PlayerWrapper} />
                <Route path={`/${countryCode}/${translations['users']}`} component={PlayerWrapper} />
              </>
            )}
            
            {/* Request Station - English + Translated */}
            <Route path={`/${countryCode}/request-station`} component={PlayerWrapper} />
            {translations['request-station'] && (
              <Route path={`/${countryCode}/${translations['request-station']}`} component={PlayerWrapper} />
            )}
            
            {/* Recommendations - English + Translated */}
            <Route path={`/${countryCode}/recommendations`} component={PlayerWrapper} />
            {translations['recommendations'] && (
              <Route path={`/${countryCode}/${translations['recommendations']}`} component={PlayerWrapper} />
            )}
            
            {/* Privacy Policy - English + Translated */}
            <Route path={`/${countryCode}/privacy-policy`} component={PlayerWrapper} />
            {translations['privacy-policy'] && (
              <Route path={`/${countryCode}/${translations['privacy-policy']}`} component={PlayerWrapper} />
            )}
            
            {/* Applications - English + Translated */}
            <Route path={`/${countryCode}/applications`} component={ApplicationsWrapper} />
            {translations['applications'] && (
              <Route path={`/${countryCode}/${translations['applications']}`} component={ApplicationsWrapper} />
            )}
            
            {/* Pages/Privacy Policy - English + Translated */}
            <Route path={`/${countryCode}/pages/privacy-policy`} component={PlayerWrapper} />
            {translations['pages'] && translations['privacy-policy'] && (
              <Route path={`/${countryCode}/${translations['pages']}/${translations['privacy-policy']}`} component={PlayerWrapper} />
            )}
            
            {/* Pages/Terms and Conditions - English + Translated */}
            <Route path={`/${countryCode}/pages/terms-and-conditions`} component={PlayerWrapper} />
            {translations['pages'] && translations['terms-and-conditions'] && (
              <Route path={`/${countryCode}/${translations['pages']}/${translations['terms-and-conditions']}`} component={PlayerWrapper} />
            )}
            
            {/* Change Password - English + Translated */}
            <Route path={`/${countryCode}/change-password`} component={PlayerWrapper} />
            {translations['change-password'] && (
              <Route path={`/${countryCode}/${translations['change-password']}`} component={PlayerWrapper} />
            )}
            
            {/* Favorites - English + Translated */}
            <Route path={`/${countryCode}/favorites`} component={PlayerWrapper} />
            {translations['favorites'] && (
              <Route path={`/${countryCode}/${translations['favorites']}`} component={PlayerWrapper} />
            )}
            
            {/* Profile/Favorites routes - English + Translated */}
            <Route path={`/${countryCode}/profile/favorites`} component={PlayerWrapper} />
            {translations['profile'] && (
              <Route path={`/${countryCode}/${translations['profile']}/favorites`} component={PlayerWrapper} />
            )}
            {translations['favorites'] && (
              <Route path={`/${countryCode}/profile/${translations['favorites']}`} component={PlayerWrapper} />
            )}
            {translations['profile'] && translations['favorites'] && (
              <Route path={`/${countryCode}/${translations['profile']}/${translations['favorites']}`} component={PlayerWrapper} />
            )}
            
            <Route path={`/${countryCode}/profile/discover`} component={PlayerWrapper} />
            {translations['profile'] && (
              <Route path={`/${countryCode}/${translations['profile']}/discover`} component={PlayerWrapper} />
            )}
            {translations['discover'] && (
              <Route path={`/${countryCode}/profile/${translations['discover']}`} component={PlayerWrapper} />
            )}
            {translations['profile'] && translations['discover'] && (
              <Route path={`/${countryCode}/${translations['profile']}/${translations['discover']}`} component={PlayerWrapper} />
            )}
            
            <Route path={`/${countryCode}/profile/settings`} component={PlayerWrapper} />
            {translations['profile'] && (
              <Route path={`/${countryCode}/${translations['profile']}/settings`} component={PlayerWrapper} />
            )}
            {translations['settings'] && (
              <Route path={`/${countryCode}/profile/${translations['settings']}`} component={PlayerWrapper} />
            )}
            {translations['profile'] && translations['settings'] && (
              <Route path={`/${countryCode}/${translations['profile']}/${translations['settings']}`} component={PlayerWrapper} />
            )}
            
            <Route path={`/${countryCode}/profile/notifications`} component={PlayerWrapper} />
            {translations['profile'] && (
              <Route path={`/${countryCode}/${translations['profile']}/notifications`} component={PlayerWrapper} />
            )}
            {translations['notifications'] && (
              <Route path={`/${countryCode}/profile/${translations['notifications']}`} component={PlayerWrapper} />
            )}
            {translations['profile'] && translations['notifications'] && (
              <Route path={`/${countryCode}/${translations['profile']}/${translations['notifications']}`} component={PlayerWrapper} />
            )}

            {/* Messages - English + Translated */}
            <Route path={`/${countryCode}/profile/followers`} component={PlayerWrapper} />
            <Route path={`/${countryCode}/profile/following`} component={PlayerWrapper} />
            <Route path={`/${countryCode}/profile/messages`} component={PlayerWrapper} />
            <Route path={`/${countryCode}/profile/messages/:rest*`} component={PlayerWrapper} />
            {translations['profile'] && (
              <>
                <Route path={`/${countryCode}/${translations['profile']}/followers`} component={PlayerWrapper} />
                <Route path={`/${countryCode}/${translations['profile']}/following`} component={PlayerWrapper} />
                <Route path={`/${countryCode}/${translations['profile']}/messages`} component={PlayerWrapper} />
              </>
            )}
            {translations['messages'] && (
              <Route path={`/${countryCode}/profile/${translations['messages']}`} component={PlayerWrapper} />
            )}
            {translations['profile'] && translations['messages'] && (
              <Route path={`/${countryCode}/${translations['profile']}/${translations['messages']}`} component={PlayerWrapper} />
            )}
            
            <Route path={`/${countryCode}/profile`} component={PlayerWrapper} />
            {translations['profile'] && translations['profile'] !== 'profile' && (
              <Route path={`/${countryCode}/${translations['profile']}`} component={PlayerWrapper} />
            )}
            
            {/* Regions routes - English + Translated */}
            <Route path={`/${countryCode}/regions`} component={PlayerWrapper} />
            <Route path={`/${countryCode}/regions/:regionSlug`} component={PlayerWrapper} />
            <Route path={`/${countryCode}/regions/:regionSlug/:countrySlug`} component={PlayerWrapper} />
            <Route path={`/${countryCode}/regions/:regionSlug/:countrySlug/:citySlug?/stations`} component={PlayerWrapper} />
            {translations['regions'] && (
              <>
                <Route path={`/${countryCode}/${translations['regions']}`} component={PlayerWrapper} />
                <Route path={`/${countryCode}/${translations['regions']}/:regionSlug`} component={PlayerWrapper} />
                <Route path={`/${countryCode}/${translations['regions']}/:regionSlug/:countrySlug`} component={PlayerWrapper} />
                <Route path={`/${countryCode}/${translations['regions']}/:regionSlug/:countrySlug/:citySlug?/${translations['stations'] || 'stations'}`} component={PlayerWrapper} />
              </>
            )}

            {/* Trending - English + Translated */}
            <Route path={`/${countryCode}/trending`} component={PlayerWrapper} />
            {translations['trending'] && (
              <Route path={`/${countryCode}/${translations['trending']}`} component={PlayerWrapper} />
            )}
          </React.Fragment>
        );
      })}
      
      {/* Profile routes - MUST come BEFORE country wildcard routes to avoid conflicts */}
      {/* Uses PlayerWrapper which provides RadioHeader and Footer */}
      <Route path="/profile/favorites" component={PlayerWrapper} />
      <Route path="/profile/discover" component={PlayerWrapper} />
      <Route path="/profile/settings" component={PlayerWrapper} />
      <Route path="/profile/followers" component={PlayerWrapper} />
      <Route path="/profile/following" component={PlayerWrapper} />
      <Route path="/profile/notifications" component={PlayerWrapper} />
      <Route path="/profile/messages" component={PlayerWrapper} />
      <Route path="/profile/messages/:rest*" component={PlayerWrapper} />
      <Route path="/profile" component={PlayerWrapper} />
      
      {/* Country code routes (for countries without specific language translations) */}
      <Route path="/:countryCode" component={PlayerWrapper} />
      <Route path="/:countryCode/genres" component={PlayerWrapper} />
      <Route path="/:countryCode/genres/:slug" component={PlayerWrapper} />
      <Route path="/:countryCode/about" component={PlayerWrapper} />
      <Route path="/:countryCode/contact" component={PlayerWrapper} />
      <Route path="/:countryCode/feedback" component={PlayerWrapper} />
      <Route path="/:countryCode/llms" component={PlayerWrapper} />
      <Route path="/:countryCode/terms-and-conditions" component={PlayerWrapper} />
      <Route path="/:countryCode/login" component={PlayerWrapper} />
      <Route path="/:countryCode/signup" component={PlayerWrapper} />
      <Route path="/:countryCode/forgot-password" component={PlayerWrapper} />
      <Route path="/:countryCode/radios" component={PlayerWrapper} />
      <Route path="/:countryCode/station/:slug" component={PlayerWrapper} />
      <Route path="/:countryCode/stations/:id" component={PlayerWrapper} />
      <Route path="/:countryCode/users/:id" component={PlayerWrapper} />
      <Route path="/:countryCode/users" component={PlayerWrapper} />
      <Route path="/:countryCode/request-station" component={PlayerWrapper} />
      <Route path="/:countryCode/recommendations" component={PlayerWrapper} />
      <Route path="/:countryCode/privacy-policy" component={PlayerWrapper} />
      <Route path="/:countryCode/applications" component={ApplicationsWrapper} />
      <Route path="/:countryCode/pages/privacy-policy" component={PlayerWrapper} />
      <Route path="/:countryCode/pages/terms-and-conditions" component={PlayerWrapper} />
      <Route path="/:countryCode/change-password" component={PlayerWrapper} />
      <Route path="/:countryCode/favorites" component={PlayerWrapper} />
      
      {/* Country-specific regions routes */}
      <Route path="/:countryCode/regions" component={PlayerWrapper} />
      <Route path="/:countryCode/regions/:regionSlug" component={PlayerWrapper} />
      <Route path="/:countryCode/regions/:regionSlug/:countrySlug" component={PlayerWrapper} />
      <Route path="/:countryCode/regions/:regionSlug/:countrySlug/:citySlug?/stations" component={PlayerWrapper} />

      
      {/* Country-code profile routes - Uses PlayerWrapper which provides RadioHeader and Footer */}
      <Route path="/:countryCode/profile/favorites" component={PlayerWrapper} />
      <Route path="/:countryCode/profile/discover" component={PlayerWrapper} />
      <Route path="/:countryCode/profile/settings" component={PlayerWrapper} />
      <Route path="/:countryCode/profile/notifications" component={PlayerWrapper} />
      <Route path="/:countryCode/profile/messages" component={PlayerWrapper} />
      <Route path="/:countryCode/profile/messages/:rest*" component={PlayerWrapper} />
      <Route path="/:countryCode/profile" component={PlayerWrapper} />
      
      {/* Default language routes */}
      {/* Standalone pages - no wrapper */}
      <Route path="/applications" component={ApplicationsWrapper} />

      
      {/* Public routes - only specific paths handled by PlayerWrapper */}
      <Route path="/about" component={PlayerWrapper} />
      <Route path="/contact" component={PlayerWrapper} />
      <Route path="/feedback" component={PlayerWrapper} />
      <Route path="/llms" component={PlayerWrapper} />
      <Route path="/terms-and-conditions" component={PlayerWrapper} />
      <Route path="/login" component={PlayerWrapper} />
      <Route path="/tv" component={PlayerWrapper} />
      <Route path="/activate" component={PlayerWrapper} />
      <Route path="/activate/:rest*" component={PlayerWrapper} />
      <Route path="/premium" component={PlayerWrapper} />
      <Route path="/premium/:rest*" component={PlayerWrapper} />
      <Route path="/signup" component={PlayerWrapper} />
      <Route path="/forgot-password" component={PlayerWrapper} />
      <Route path="/auth/:rest*" component={PlayerWrapper} />
      <Route path="/genres" component={PlayerWrapper} />
      <Route path="/genres/:rest*" component={PlayerWrapper} />
      <Route path="/radios/:rest*" component={PlayerWrapper} />
      <Route path="/change-password" component={PlayerWrapper} />
      <Route path="/trending" component={PlayerWrapper} />
      <Route path="/users/:rest*" component={PlayerWrapper} />
      <Route path="/request-station" component={PlayerWrapper} />
      <Route path="/recommendations" component={PlayerWrapper} />
      <Route path="/privacy-policy" component={PlayerWrapper} />
      <Route path="/station/:rest*" component={PlayerWrapper} />
      <Route path="/stations/:rest*" component={PlayerWrapper} />
      <Route path="/" component={PlayerWrapper} />
      
      {/* CRITICAL: Catch-all for country-code + translated paths (e.g., /at/profil/favoriten)
          This MUST come before the 404 route. PlayerWrapper/PublicRouter will handle translation
          via useSeoRouting.englishPath and renderByCleanPath() */}
      {/* Wouter uses a standalone * for multiple segments. :rest* only
          matched one segment, so localized payment return URLs hit 404. */}
      <Route path="/:countryCode/*" component={PlayerWrapper} />
      
      {/* 404 for any unmatched routes - Suspense needed since NotFound is lazy */}
      <Route component={() => (
        <Suspense fallback={<div className="min-h-screen bg-[#0E0E0E]" />}>
          <LazyRoutes.NotFound />
        </Suspense>
      )} />
    </Switch>
  );
});

function Router() {
  // Track page views when routes change
  useAnalytics();
  
  return (
    <Switch>
      <Route path="/admin*">
        <AdminLayout />
      </Route>
      <Route>
        <SeoMainRouter />
      </Route>
    </Switch>
  );
}

function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [location, setLocation] = useLocation();
  
  // Automatically scroll to top when page changes
  useScrollToTop();

  // Quick-search shortcuts belong to the public header. Opening its dialog
  // must not navigate, scroll the page, or remount the player/route subtree.

  // 🚀 MAIN THREAD OPTIMIZATION: Defer non-critical initialization
  // Google measurement initializes before mount in main.tsx; background audio
  // setup can yield to the initial render.
  useEffect(() => {
    const deferInit = () => {
      // Initialize background playback if user previously accepted
      initializeBackgroundPlayback();
    };
    
    if ('requestIdleCallback' in window) {
      requestIdleCallback(deferInit, { timeout: 2000 });
    } else {
      setTimeout(deferInit, 100);
    }
  }, []);

  // 🚀 PRELOAD: Eagerly load common route chunks so Suspense navigation has
  // no flash — but only AFTER the first user interaction (PageSpeed 2026-07-03).
  // The previous unconditional 500ms timer fetched ~40 chunks during initial
  // load; on slow 4G those requests competed with the hero image and the
  // station APIs for bandwidth, inflating LCP/SI (mobile perf score 50).
  // First interaction is the earliest moment a navigation can possibly
  // happen, so warming there keeps the same no-flash behavior for real users
  // while first paint (and Lighthouse, which never interacts) pays nothing.
  // Respect Data Saver: skip preloading entirely.
  useEffect(() => {
    if ((navigator as any).connection?.saveData) return;
    let done = false;
    const preloadRoutes = () => {
      if (done) return;
      done = true;
      events.forEach(([target, ev]) => target.removeEventListener(ev, preloadRoutes));
      Promise.allSettled([
        // Most-visited pages (load first)
        import("@/pages/stations/[id]"),
        import("@/pages/TrendingStations"),
        import("@/pages/not-found"),
        // Profile/auth chunks
        import("@/components/layout/ProfileLayout"),
        import("@/pages/messages"),
        import("@/pages/favorites"),
        import("@/pages/profile-discover"),
        import("@/pages/profile-settings"),
        import("@/pages/notifications-view"),
        import("@/pages/login"),
        import("@/pages/auth/login"),
        import("@/pages/auth/signup"),
      ]);
    };
    const events: Array<[EventTarget, string]> = [
      [window, 'pointerdown'],
      [window, 'keydown'],
      [window, 'touchstart'],
      [window, 'wheel'],
      [window, 'scroll'],
    ];
    events.forEach(([target, ev]) =>
      target.addEventListener(ev, preloadRoutes, { once: true, passive: true } as AddEventListenerOptions),
    );
    return () => {
      events.forEach(([target, ev]) => target.removeEventListener(ev, preloadRoutes));
    };
  }, []);
  
  // Keep both language and writing direction aligned with SSR after SPA switches.
  useEffect(() => {
    const { language } = getLanguageFromPath(location);
    syncDocumentLocale(language, location);
  }, [location]);
  
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter hook={usePaymentSafeLocation} base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <TranslationProvider>
        <FavoriteStateProvider>
        <TranslationPreloader />
        <RecommendationsPrefetcher />
        <PushNotificationBridge />
        <ThemeProvider defaultTheme="system" storageKey="radio-ui-theme">
          <LazyGlobalPlayerProvider>
            <TooltipProvider>
              <LazyToaster />
              <StructuredData />
              <Router />
            </TooltipProvider>
          </LazyGlobalPlayerProvider>
        </ThemeProvider>
        </FavoriteStateProvider>
        </TranslationProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

// 🚀 LAZY: Admin layout fallbacks - minimal skeleton during load
const AdminSidebarFallback = () => (
  <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-gray-100" />
);
const AdminHeaderFallback = () => (
  <div className="h-16 bg-white shadow-sm border-b border-gray-200" />
);

function AdminLayout() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    // Include body-mounted dialogs without changing the public site's palette.
    const hadRadioTheme = document.body.classList.contains('radio-theme');
    document.body.classList.add('admin-theme');
    document.body.classList.remove('radio-theme');
    document.documentElement.classList.remove('dark');
    return () => {
      document.body.classList.remove('admin-theme');
      if (hadRadioTheme) document.body.classList.add('radio-theme');
      const useDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', useDark);
      document.documentElement.classList.toggle('light', !useDark);
    };
  }, [theme]);

  return (
    <AdminRoute>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* 🚀 LAZY: Sidebar only loads for admin users */}
        <Suspense fallback={<AdminSidebarFallback />}>
          <Sidebar 
            isMobileMenuOpen={isMobileMenuOpen}
            setIsMobileMenuOpen={setIsMobileMenuOpen}
          />
        </Suspense>
        <div className="flex flex-col w-0 flex-1 overflow-hidden">
          {/* 🚀 LAZY: Header only loads for admin users */}
          <Suspense fallback={<AdminHeaderFallback />}>
            <Header 
              onMobileMenuToggle={() => setIsMobileMenuOpen(open => !open)}
              isMobileMenuOpen={isMobileMenuOpen}
            />
          </Suspense>
          <main className="flex-1 overflow-y-auto bg-background">
            <AdminRouterContent />
          </main>
        </div>
        {/* Mobile menu overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black bg-opacity-50 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </div>
    </AdminRoute>
  );
}

export default App;
