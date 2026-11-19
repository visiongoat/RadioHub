import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useInView, MotionConfig } from "framer-motion";
import {
  Crown, Sparkles, Check, ChevronDown, Loader2,
  Volume2, Zap, Radio, Music, Tv, Star, Shield, Wifi, Smartphone,
  Lock, BadgeCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePremiumStatus } from "@/hooks/usePremiumStatus";
import { useSubscriptionCheckout } from "@/hooks/useSubscriptionCheckout";
import { useLocation } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";
import { PLAN_LABEL, fmtPrice, type PlanInfo } from "@/lib/premium";
import { useSubscriptionPlans } from '@/hooks/useSubscriptionPlans';
import { subscriptionCopy } from '@/lib/subscription-copy';
import { ManageSubscriptionButton } from '@/components/ManageSubscriptionButton';

// ── Constants ────────────────────────────────────────────────────────────────

const PLAN_ORDER = ["premium_yearly", "premium_quarterly", "premium_monthly", "premium_lifetime", "remove_ads"];
const RECOMMENDED = "premium_yearly";

const PLAN_FEATURES: Record<string, string[]> = {
  remove_ads: [
    "MegaRadio website ads removed",
    "Linked to your account",
    "Same stream quality as free",
  ],
  premium_monthly: [
    "MegaRadio website ads removed",
    "Stream quality depends on the station",
    "App features vary by device",
    "Linked to your account",
    "Cancel anytime",
  ],
  premium_quarterly: [
    "MegaRadio website ads removed",
    "Stream quality depends on the station",
    "App features vary by device",
    "Linked to your account",
    "Billed every 3 months",
    "Cancel anytime",
  ],
  premium_yearly: [
    "MegaRadio website ads removed",
    "Stream quality depends on the station",
    "App features vary by device",
    "Linked to your account",
    "Annual billing",
    "Cancel anytime",
  ],
  premium_lifetime: [
    "MegaRadio website ads removed",
    "Stream quality depends on the station",
    "App features vary by device",
    "Linked to your account",
    "One-time purchase",
    "See subscription terms for details",
  ],
};

const FAQ_ITEMS = [
  {
    q: "Can I cancel my subscription at any time?",
    a: "Yes. Monthly, quarterly and annual plans can be cancelled anytime from your account settings. You keep access until the end of your billing period.",
  },
  {
    q: "What devices are supported?",
    a: "Use the same MegaRadio account on supported devices. Available features vary by app and device; check the app before purchasing for a specific feature.",
  },
  {
    q: "What's the difference between Remove Ads and Premium?",
    a: "Remove Ads removes MegaRadio website advertising without premium extras. Ads included in a station's broadcast may remain. Stream quality depends on the station, and extra app features depend on your device.",
  },
  {
    q: "Is Lifetime really a one-time payment?",
    a: "The Lifetime plan is a one-time purchase, not a recurring subscription. Review the current subscription terms and final checkout details before paying.",
  },
  {
    q: "What payment methods are accepted?",
    a: "All major credit and debit cards. Payments are encrypted and processed securely by Paddle — we never see your card details.",
  },
];

const FEATURES = [
  { icon: Zap,     title: "Website Ads", desc: "Remove advertising served by MegaRadio on the website. Station broadcast ads may remain." },
  { icon: Volume2, title: "Stream Quality", desc: "Audio quality and availability depend on the station's source stream and your connection." },
  { icon: Radio,   title: "Your Account", desc: "Your purchase is linked to your MegaRadio account. Sign in to access it." },
  { icon: Music,   title: "Your Stations", desc: "Continue enjoying your stations and favourites without changing your listening habits." },
  { icon: Tv,      title: "Supported Devices", desc: "Use the same account. Extra features vary by application and device." },
  { icon: Star,    title: "Your Subscription", desc: "Review your plan and manage supported recurring subscriptions from your account." },
];

// ── Animations ────────────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show:   { opacity: 1, y: 0 },
};

const stagger = {
  show: { transition: { staggerChildren: 0.07 } },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.07] last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-4 sm:py-5 text-left gap-4 group"
        aria-expanded={open}
      >
        <span className="text-sm sm:text-base font-medium text-white/90 group-hover:text-white transition-colors">
          {q}
        </span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-4 h-4 text-white/30 flex-shrink-0" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-sm text-white/45 leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface PlanCardProps {
  plan: PlanInfo;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}

function PlanCard({ plan, selected, recommended, onSelect }: PlanCardProps) {
  const { language, t } = useTranslation();
  const copy = subscriptionCopy(language);
  const features = PLAN_FEATURES[plan.planId] ?? [];
  const price = fmtPrice(plan.amount, plan.currency, language);
  const period = plan.billingInterval === 'month' ? (plan.billingFrequency === 3 ? '/3 mo' : '/mo') : plan.billingInterval === 'year' ? '/yr' : '';
  const isOneTime = plan.planId === "premium_lifetime" || plan.planId === 'remove_ads'
    && plan.checkoutAvailable === true && plan.billingInterval === null && plan.billingFrequency === null;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      variants={fadeUp}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={[
        "relative flex flex-col text-left w-full rounded-2xl p-5 sm:p-6 border transition-colors duration-200 focus:outline-none",
        selected
          ? recommended
            ? "border-[#FF4199]/60 bg-gradient-to-b from-[#FF4199]/[0.13] to-[#FF4199]/[0.04] shadow-2xl shadow-[#FF4199]/20"
            : "border-[#FF4199]/40 bg-[#FF4199]/[0.07]"
          : "border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.045]",
      ].join(" ")}
    >
      {/* Animated gradient border for recommended */}
      {recommended && (
        <div
          aria-hidden="true"
          className="absolute -inset-px rounded-2xl pointer-events-none"
          style={{
            background: "linear-gradient(135deg,#FF4199,#FF6B35)",
            WebkitMask: "linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            padding: "1px",
            opacity: selected ? 1 : 0.35,
            transition: "opacity 0.2s",
          }}
        />
      )}

      {/* Header row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="text-sm font-semibold text-white/60 uppercase tracking-widest">
            {t(`premium_plan_${plan.planId}`, plan.label)}
          </span>
          {recommended && (
            <div className="mt-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-[#FF4199] to-[#FF6B35] text-white px-2.5 py-0.5 rounded-full">
                {t('premium_plan_annual', 'Annual')}
              </span>
            </div>
          )}
          {isOneTime && (
            <div className="mt-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/70 px-2.5 py-0.5 rounded-full">
                {t('premium_payment_once', 'One-time payment')}
              </span>
            </div>
          )}
        </div>
        {/* Selection indicator */}
        <div
          className={[
            "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-150",
            selected ? "border-[#FF4199] bg-[#FF4199]" : "border-white/20",
          ].join(" ")}
        >
          {selected && <div className="w-2 h-2 rounded-full bg-white" />}
        </div>
      </div>

      {/* Price */}
      <div className="mb-5">
        {price ? (
          <>
            <div className="flex items-end gap-1">
              <span className="text-4xl sm:text-5xl font-black tracking-tight text-white leading-none tabular-nums">
                {price}
              </span>
              {period && (
                <span className="text-white/35 text-sm mb-1">{period}</span>
              )}
            </div>
            {plan.billingInterval === "year" && (plan.billingFrequency ?? 1) === 1 && (
              <p className="text-[#FF4199] text-xs mt-1.5 font-medium">
                ~{fmtPrice(Math.round(plan.amount / 12), plan.currency, language)}/mo
              </p>
            )}
          </>
        ) : (
          <div className="h-12 flex items-center">
            <span className="text-sm text-white/50">{plan.checkoutAvailable === false ? copy.unavailable : copy.price}</span>
          </div>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-2.5 flex-1">
        {features.map(f => (
          <li key={f} className="flex items-center gap-2 text-sm text-white/55">
            <Check className="w-3.5 h-3.5 text-[#FF4199] flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>
    </motion.button>
  );
}

// ── Scroll-reveal wrapper ─────────────────────────────────────────────────────

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ── Already-premium screen ────────────────────────────────────────────────────

function AlreadyPremium({ plan }: { plan: string }) {
  const [, setLocation] = useLocation();
  const { language } = useTranslation();
  const copy = subscriptionCopy(language);
  const label = PLAN_LABEL[plan] ?? "Premium";
  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center p-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#FF4199]/[0.08] blur-[120px]" />
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative text-center space-y-6 max-w-xs"
      >
        <div className="w-20 h-20 rounded-[28px] bg-gradient-to-br from-[#FF4199] to-[#FF6B35] flex items-center justify-center mx-auto shadow-2xl shadow-[#FF4199]/40">
          <Crown className="w-10 h-10 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-white mb-2">{copy.active}</h1>
          <p className="text-white/50">
            <span className="text-[#FF4199] font-semibold">{label}</span>
          </p>
        </div>
        <button
          onClick={() => setLocation(`/${language}`)}
          className="w-full h-11 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.08] text-white text-sm font-medium transition-colors"
        >
          Back to Radio
        </button>
        <ManageSubscriptionButton />
      </motion.div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PremiumPage() {
  const { t, language } = useTranslation();
  const copy = subscriptionCopy(language);
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const { isActive, plan: currentPlan } = usePremiumStatus();
  const [selectedPlan, setSelectedPlan] = useState(RECOMMENDED);
  const { loading, error, checkout } = useSubscriptionCheckout();

  const catalog = useSubscriptionPlans(!isActive);
  const rawPlans = catalog.plans;
  useEffect(() => {
    if (rawPlans.length && !rawPlans.some(plan => plan.planId === selectedPlan)) setSelectedPlan(rawPlans[0].planId);
  }, [rawPlans, selectedPlan]);

  const plans = PLAN_ORDER
    .map(id => rawPlans.find(p => p.planId === id))
    .filter(Boolean) as PlanInfo[];

  const selectedPlanInfo = plans.find(p => p.planId === selectedPlan);
  const checkoutDisabled = loading || !!authError || !catalog.canCheckout(selectedPlan);

  if (!authLoading && isActive) return <AlreadyPremium plan={currentPlan} />;
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#FF4199] animate-spin" />
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-[#080808] text-white selection:bg-[#FF4199]/30">

      {/* ── Ambient background ──────────────────────────────────────────────── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 left-[10%] w-[800px] h-[800px] rounded-full bg-[#FF4199]/[0.055] blur-[160px]" />
        <div className="absolute top-[40%] right-[-5%] w-[600px] h-[600px] rounded-full bg-[#9B59B6]/[0.04] blur-[140px]" />
        <div className="absolute bottom-[-10%] left-[30%] w-[700px] h-[400px] rounded-full bg-[#FF6B35]/[0.04] blur-[120px]" />
      </div>

      <div className="relative">

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/*  HERO + PLANS  (everything above the fold)                         */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-6">

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex justify-center mb-5"
          >
            <span className="inline-flex items-center gap-2 bg-gradient-to-r from-[#FF4199]/15 to-[#FF6B35]/15 border border-[#FF4199]/25 text-[#FF4199] text-xs font-semibold px-4 py-1.5 rounded-full backdrop-blur-sm">
              <Crown className="w-3.5 h-3.5" />
              MegaRadio Premium
            </span>
          </motion.div>

          {/* Headline */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="text-center mb-3"
          >
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-[1.1]">
              {t("premium_hero_stations", "60,000+ stations.")}{" "}
              <span
                className="bg-gradient-to-r from-[#FF4199] via-[#FF6B35] to-[#FF4199] bg-clip-text text-transparent"
                style={{ backgroundSize: "200%" }}
              >
                {t("premium_hero_zero_ads", "Zero ads.")}
              </span>
            </h1>
            <p className="text-white/45 text-base sm:text-lg mt-2.5 max-w-lg mx-auto">
              {t("premium_hero_sub", "Pick a plan and start listening ad-free in under a minute.")}
            </p>
          </motion.div>

          {/* Device strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1.5 mb-8 text-white/30 text-xs"
          >
            {[
              { icon: Smartphone, label: "iOS" },
              { icon: Smartphone, label: "Android" },
              { icon: Tv,         label: "Samsung TV" },
              { icon: Tv,         label: "LG TV" },
              { icon: Wifi,       label: "Web" },
            ].map(({ icon: Icon, label }, i) => (
              <span key={label} className="flex items-center gap-1">
                {i > 0 && <span className="mr-2 opacity-30">·</span>}
                <Icon className="w-3 h-3" />
                {label}
              </span>
            ))}
          </motion.div>

          {/* ── Plan cards grid ──────────────────────────────────────────────── */}
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4"
          >
            {plans.map(plan => (
              <PlanCard
                key={plan.planId}
                plan={plan}
                selected={selectedPlan === plan.planId}
                recommended={plan.planId === RECOMMENDED}
                onSelect={() => setSelectedPlan(plan.planId)}
              />
            ))}
          </motion.div>

          {/* ── Primary CTA ─────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35 }}
            className="mt-5 max-w-md mx-auto"
          >
            <button
              onClick={() => checkout(selectedPlan)}
              disabled={checkoutDisabled}
              className="w-full h-14 rounded-2xl font-bold text-base text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2.5 shadow-2xl shadow-[#FF4199]/30"
            >
              {loading
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                : user
                  ? <><Sparkles className="w-5 h-5" /> Get {selectedPlanInfo?.label ?? "Premium"}</>
                  : t("premium_cta_signin", "Sign In to Subscribe")
              }
            </button>

            {!user && (
              <p className="text-center text-xs text-white/30 mt-3">
                {t("premium_have_account", "Already have an account?")}{" "}
                <a
                  href={`/${language}/login?returnTo=${encodeURIComponent(`/${language}/premium`)}`}
                  className="text-[#FF4199] hover:underline"
                >
                  {t("premium_signin", "Sign in")}
                </a>
              </p>
            )}

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-3 text-center text-sm text-red-400 bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-2.5"
              >
                {error}
              </motion.p>
            )}
            {!catalog.isPending && !catalog.canCheckout(selectedPlan) && (
              <p role="status" className="mt-3 text-center text-sm text-amber-400">{copy.unavailable}</p>
            )}
            <p className="mt-3 text-center text-xs text-white/50">{copy.broadcastAds}</p>

            {/* Payment trust row — a payment page must answer "is this safe?"
                at the exact moment of commitment. All claims are true: Paddle
                is our Merchant of Record and PCI DSS Level 1 certified; card
                data never touches our servers. */}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                { icon: Lock,       label: t("premium_trust_ssl", "SSL encrypted") },
                { icon: Shield,     label: t("premium_trust_paddle", "Secured by Paddle") },
                { icon: BadgeCheck, label: t("premium_trust_cancel", "Cancel anytime") },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1.5 rounded-xl bg-white/[0.02] border border-white/[0.05] px-2 py-3">
                  <Icon className="w-4 h-4 text-[#FF4199]/80" />
                  <span className="text-[11px] leading-tight text-white/40">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-white/25 mt-3 leading-relaxed">
              {t("premium_legal_processor", "Payments are processed by Paddle.com as Merchant of Record — your card details never reach our servers.")}{" "}
              <a href={`/${language}/terms-and-conditions`} className="underline hover:text-white/50 transition-colors">{t("footer_terms", "Terms")}</a>
              {" · "}
              <a href={`/${language}/privacy-policy`} className="underline hover:text-white/50 transition-colors">{t("footer_privacy", "Privacy")}</a>
            </p>
          </motion.div>
        </section>

        {/* ── Social proof strip ──────────────────────────────────────────────── */}
        <Reveal delay={0.05}>
          <section className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
            <div className="grid grid-cols-3 divide-x divide-white/[0.07] bg-white/[0.025] border border-white/[0.06] rounded-2xl overflow-hidden">
              {[
                { value: "60,000+", label: t("premium_stat_stations", "Stations") },
                { value: "120+",    label: t("premium_stat_countries", "Countries") },
                { value: "14",      label: t("premium_stat_languages", "Languages") },
              ].map(({ value, label }) => (
                <div key={label} className="flex flex-col items-center py-5 px-3">
                  <span className="text-2xl sm:text-3xl font-black text-white">{value}</span>
                  <span className="text-[11px] text-white/30 uppercase tracking-widest mt-1">{label}</span>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        {/* ── Feature grid ────────────────────────────────────────────────────── */}
        <Reveal>
          <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-16">
            <h2 className="text-xl sm:text-2xl font-bold text-center mb-7">
              {t("premium_features_title", "Everything in")}{" "}
              <span className="bg-gradient-to-r from-[#FF4199] to-[#FF6B35] bg-clip-text text-transparent">
                Premium
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div
                  key={title}
                  className="flex gap-3.5 bg-white/[0.025] border border-white/[0.06] rounded-xl p-4 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#FF4199]/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-[#FF4199]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white mb-0.5">{title}</p>
                    <p className="text-xs text-white/35 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
        <Reveal>
          <section className="max-w-2xl mx-auto px-4 sm:px-6 pb-16">
            <h2 className="text-xl sm:text-2xl font-bold text-center mb-7">
              {t("premium_faq_title", "Common questions")}
            </h2>
            <div className="bg-white/[0.025] border border-white/[0.06] rounded-2xl px-5 sm:px-7">
              {FAQ_ITEMS.map(item => (
                <FaqItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </section>
        </Reveal>

        {/* ── Bottom CTA ──────────────────────────────────────────────────────── */}
        <Reveal>
          <section className="max-w-lg mx-auto px-4 sm:px-6 pb-28 sm:pb-20">
            <div className="relative bg-gradient-to-b from-white/[0.05] to-white/[0.02] border border-white/[0.08] rounded-3xl p-8 sm:p-10 text-center overflow-hidden">
              <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
                <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-72 h-36 bg-[#FF4199]/15 blur-[70px]" />
              </div>
              <Crown className="w-9 h-9 text-[#FF4199] mx-auto mb-4" />
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">{t("premium_bottom_title", "Ready to go ad-free?")}</h3>
              <p className="text-white/40 text-sm mb-6">
                {t("premium_bottom_sub", "Listeners in 120+ countries already switched.")}
              </p>
              <button
                onClick={() => checkout(selectedPlan)}
                disabled={checkoutDisabled}
                className="w-full h-14 rounded-2xl font-bold text-base text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 shadow-xl shadow-[#FF4199]/25"
              >
                {loading
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                  : user
                    ? <><Sparkles className="w-5 h-5" /> Get {selectedPlanInfo?.label ?? "Premium"}</>
                    : t("premium_cta_signin", "Sign In to Subscribe")
                }
              </button>
            </div>
          </section>
        </Reveal>

      </div>

      {/* ── Mobile sticky bar ─────────────────────────────────────────────────── */}
      <div
        className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-[#080808]/95 backdrop-blur-xl border-t border-white/[0.07] px-4 py-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-bold truncate">
              {selectedPlanInfo?.label ?? "Premium"}
            </p>
            <p className="text-white/40 text-xs">
              {fmtPrice(selectedPlanInfo?.amount ?? 0, selectedPlanInfo?.currency ?? "eur", language) || copy.price}
              {selectedPlanInfo?.billingInterval === 'month' ? '/mo' : selectedPlanInfo?.billingInterval === 'year' ? '/yr' : ''}
            </p>
          </div>
          <button
            onClick={() => checkout(selectedPlan)}
            disabled={checkoutDisabled}
            className="h-11 px-5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-[#FF4199] to-[#FF6B35] hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0 transition-opacity"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Sparkles className="w-4 h-4" /> Subscribe</>
            }
          </button>
        </div>
      </div>

    </div>
    </MotionConfig>
  );
}
