import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Check,Loader2} from 'lucide-react';
import {useAuth} from '@/hooks/useAuth';
import {apiRequest} from '@/lib/queryClient';
import {logoutAccount} from '@/lib/logout';
import {useSubscriptionCheckout} from '@/hooks/useSubscriptionCheckout';
import {useSubscriptionPlans} from '@/hooks/useSubscriptionPlans';
import {useTranslation} from '@/hooks/useTranslation';
import {subscriptionCopy} from '@/lib/subscription-copy';
import {fmtPrice,isAdFreeSubscription} from '@/lib/premium';
import {ManageSubscriptionButton} from '@/components/ManageSubscriptionButton';

const translations={
 tr:{title:'TV’de daha fazlası.',intro:'TV’de seçtiğin paketle telefonunda devam et. Radyo çalmaya devam eder.',account:'Satın alma hesabı',mismatch:'Bu kod TV’deki başka bir hesaba ait. Ödemeye devam etmek için TV’deki hesabınla giriş yap.',switch:'Hesap değiştir',signin:'Giriş yap ve devam et',signup:'Hesap oluştur',pay:'Ödemeye devam et',waiting:'Ödeme hazırlanıyor…',expired:'Kodun süresi doldu',expiredText:'Yeni bir kod almak için TV’deki Premium ekranına dön.',completed:'TV bağlantısı tamamlandı',completedText:'Abonelik durumun sunucudan doğrulanır. TV’ndeki Premium özellikler otomatik güncellenir.',code:'TV kodun',year:'12 ay',month:'1 ay',quarter:'3 ay',life:'Ömür boyu',renewYear:'Her yıl yenilenir',renewMonth:'Her ay yenilenir',renewQuarter:'3 ayda bir yenilenir',oneTime:'Tek seferlik ödeme',features:['TV’de sınırsız sohbet izleme','Mobilde sınırsız mesajlaşma','Müzikle tanış, sohbetle bağlan','Mobilde Spotify ve YouTube Music desteği','MegaRadio reklamlarını kaldır'],terms:'Abonelik koşulları',privacy:'Gizlilik',retry:'Yeniden dene'},
 de:{title:'Mehr für deinen TV.',intro:'Fahre am Smartphone mit deinem gewählten Paket fort. Dein Radio spielt weiter.',account:'Konto für den Kauf',mismatch:'Dieser Code gehört zum Konto auf deinem TV. Melde dich mit demselben Konto an, um fortzufahren.',switch:'Konto wechseln',signin:'Anmelden und fortfahren',signup:'Konto erstellen',pay:'Weiter zur Zahlung',waiting:'Zahlung wird vorbereitet…',expired:'Code abgelaufen',expiredText:'Öffne Premium auf deinem TV, um einen neuen Code zu erhalten.',completed:'TV-Verbindung abgeschlossen',completedText:'Dein Abo wird vom Server überprüft. Premium auf deinem TV wird automatisch aktualisiert.',code:'Dein TV-Code',year:'12 Monate',month:'1 Monat',quarter:'3 Monate',life:'Lebenslang',renewYear:'Verlängert sich jährlich',renewMonth:'Verlängert sich monatlich',renewQuarter:'Verlängert sich alle 3 Monate',oneTime:'Einmalige Zahlung',features:['TV-Chat unbegrenzt mitlesen','Unbegrenzt Nachrichten in der App','Über Musik neue Menschen kennenlernen','Spotify und YouTube Music in der App','MegaRadio-Werbung entfernen'],terms:'Abonnementbedingungen',privacy:'Datenschutz',retry:'Erneut versuchen'},
 en:{title:'More for your TV.',intro:'Continue on your phone with your selected plan. Your radio keeps playing.',account:'Purchase account',mismatch:'This code belongs to the account on your TV. Sign in with that same account to continue.',switch:'Switch account',signin:'Sign in to continue',signup:'Create an account',pay:'Continue to payment',waiting:'Preparing checkout…',expired:'Code expired',expiredText:'Return to Premium on your TV to get a new code.',completed:'TV link completed',completedText:'Your subscription is verified by the server. Premium on your TV updates automatically.',code:'Your TV code',year:'12 months',month:'1 month',quarter:'3 months',life:'Lifetime',renewYear:'Renews every year',renewMonth:'Renews every month',renewQuarter:'Renews every 3 months',oneTime:'One-time payment',features:['Unlimited TV chat viewing','Unlimited messaging in the mobile app','Meet through music, connect through chat','Spotify and YouTube Music in the mobile app','Remove MegaRadio ads'],terms:'Subscription terms',privacy:'Privacy',retry:'Try again'}
};
type CodeStatus={status:'pending'|'activated'|'expired'|'not_found';accountBound?:boolean;accountMatch?:boolean;plan?:string};
export default function ActivatePage(){
 const {user,isLoading:authLoading}=useAuth();const {language}=useTranslation();
 const text=translations[language as keyof typeof translations] || translations.en;const copy=subscriptionCopy(language);
 const params=new URLSearchParams(window.location.search);const tvCode=(params.get('code')||'').trim();
 const [selectedPlan,setSelectedPlan]=useState(params.get('plan')||'premium_yearly');
 const [switching,setSwitching]=useState(false),[switchError,setSwitchError]=useState(false);
 const openAppText=language==='tr'?'MegaRadio uygulamasında devam et':language==='de'?'In MegaRadio fortfahren':'Continue in MegaRadio';
 const appUrl=`megaradio://activate?code=${encodeURIComponent(tvCode)}&plan=${encodeURIComponent(selectedPlan)}`;
 const returnTo=`/${language}/activate?code=${encodeURIComponent(tvCode)}&plan=${encodeURIComponent(selectedPlan)}`;
 const loginUrl=`/${language}/login?returnTo=${encodeURIComponent(returnTo)}`;
 const {loading,error,checkout}=useSubscriptionCheckout({extraBody:{tvCode},returnTo});
 const catalog=useSubscriptionPlans();
 const status=useQuery<CodeStatus>({
  queryKey:['/api/subscription/tv/code/status',tvCode,user?._id],
  queryFn:async({signal})=>{const response=await apiRequest('GET',`/api/subscription/tv/code/${encodeURIComponent(tvCode)}/status?deviceId=web-activate`,{signal});return response.json();},
  enabled:/^\d{6}$/.test(tvCode)&&!authLoading,staleTime:10000,retry:false,
 });
 const code=status.data;
 useEffect(()=>{if(code?.plan)setSelectedPlan(code.plan);},[code?.plan]);
 const plans=catalog.plans.filter(p=>code?.accountBound?p.planId===code.plan:['premium_monthly','premium_quarterly','premium_yearly'].includes(p.planId));
 useEffect(()=>{if(!code?.accountBound&&plans.length&&!plans.some(p=>p.planId===selectedPlan))setSelectedPlan(plans[0].planId);},[plans,selectedPlan,code?.accountBound]);
 const mismatch=!!user&&code?.accountBound===true&&code.accountMatch!==true;
 const subscribed=isAdFreeSubscription((user as any)?.subscription);
 const unavailable=status.isError||catalog.isError||!catalog.canCheckout(selectedPlan);
 const canPay=!!user&&!mismatch&&!subscribed&&!unavailable&&!loading&&code?.status==='pending';
 const invalid=!/^\d{6}$/.test(tvCode)||code?.status==='expired'||code?.status==='not_found';
 const completed=code?.status==='activated';
 const title=invalid?text.expired:completed?text.completed:text.title;
 async function switchAccount(){setSwitching(true);setSwitchError(false);try{await logoutAccount();window.location.assign(loginUrl);}catch{setSwitching(false);setSwitchError(true);}}
 return <main className="min-h-screen bg-[#0e0e0e] text-white" style={{fontFamily:'Ubuntu, sans-serif'}}>
  <section className="relative mx-auto w-full max-w-[640px] bg-[#0e0e0e]">
   <div className="pointer-events-none absolute inset-x-0 top-0 h-[350px] bg-cover bg-right-top" style={{backgroundImage:'linear-gradient(0deg,#0e0e0e,transparent 95%),url(/images/premium/tv-purchase-hero.png)'}} />
   <div className="relative px-6 pb-10 pt-[205px] sm:px-8">
    <div className="mb-5 flex items-center"><img className="mr-3 h-12 w-12" src="/images/premium/premium-brand.svg" alt=""/><div><strong className="block text-xl font-medium">MegaRadio</strong><span className="text-sm text-[#FBBC05]">Premium</span></div></div>
    <h1 className="text-2xl font-medium leading-tight">{title}</h1>
    <p className="mt-3 text-sm leading-6 text-[#bcb5c1]">{invalid?text.expiredText:completed?text.completedText:text.intro}</p>
    {!invalid&&!completed&&<a href={appUrl} className="mt-5 block rounded-lg border border-[#FF4199] px-4 py-3 text-center text-sm font-medium text-[#FF83BA]">{openAppText}</a>}
    {authLoading||status.isPending&&/^\d{6}$/.test(tvCode)?<Loader2 className="mx-auto my-8 animate-spin" aria-label={text.waiting}/>:invalid||completed?null:<>
     <div className="my-5 flex items-center justify-between border-y border-[#302b32] py-3 text-sm"><span className="text-[#aaa2ae]">{text.code}</span><strong className="tracking-[4px]">{tvCode}</strong></div>
     {!user?<div className="space-y-4"><a className="block rounded-lg bg-[#FF4199] px-4 py-3 text-center font-medium" href={loginUrl}>{text.signin}</a><a className="block text-center text-sm text-[#FF83BA]" href={`/${language}/signup?returnTo=${encodeURIComponent(returnTo)}`}>{text.signup}</a></div>:<>
      <div className="my-6 border-b border-[#303030] pb-5"><p className="text-xs text-[#b9b0be]">{text.account}</p><strong className="mt-1 block break-all text-sm font-medium">{user.email || user.fullName || user.username}</strong>
       {mismatch&&<p role="alert" className="mt-3 text-sm leading-6 text-[#FF99C4]">{text.mismatch}</p>}
       <button className="mt-3 text-sm text-[#FF83BA] underline underline-offset-4 disabled:opacity-50" onClick={switchAccount} disabled={switching}>{text.switch}</button>
      </div>
      {!mismatch&&<>
       <ul className="my-5 space-y-2">{text.features.map(feature=><li key={feature} className="flex items-start text-sm leading-5"><Check className="mr-2 mt-0.5 shrink-0 text-[#FF83BA]" size={16}/>{feature}</li>)}</ul>
       <div className="space-y-3">{plans.map(plan=><button key={plan.planId} aria-pressed={selectedPlan===plan.planId} onClick={()=>!code?.accountBound&&setSelectedPlan(plan.planId)} className={`flex w-full items-center justify-between rounded-lg border p-4 text-left ${selectedPlan===plan.planId?'border-[#FF4199] bg-[#FF4199]/10':'border-[#383438] bg-[#242124]'}`}>
        <span><strong className="block font-medium">{plan.planId==='premium_yearly'?text.year:plan.planId==='premium_monthly'?text.month:plan.planId==='premium_quarterly'?text.quarter:text.life}</strong><small className="mt-1 block text-xs text-[#bcb3c0]">{plan.billingInterval==='year'?text.renewYear:plan.billingInterval==='month'?(plan.billingFrequency===3?text.renewQuarter:text.renewMonth):text.oneTime}</small></span><strong className="ml-3 text-xl font-medium">{fmtPrice(plan.amount,plan.currency,language)}</strong>
       </button>)}</div>
       <button className="mt-5 w-full rounded-lg bg-[#FF4199] px-4 py-3 font-medium disabled:opacity-40" disabled={!canPay} onClick={()=>{if(canPay)void checkout(selectedPlan);}}>{loading?text.waiting:text.pay}</button>
       {subscribed&&<div className="mt-4 text-sm text-[#bdb6c1]"><p>{copy.active}</p><ManageSubscriptionButton/></div>}
      </>}
     </>}
    </>}
    {(unavailable&&!invalid&&!completed||switchError)&&<div role="status" className="mt-4 text-sm text-[#d6bbcf]"><p>{copy.unavailable}</p><button className="mt-2 underline" onClick={()=>{void status.refetch();void catalog.refetch();}}>{text.retry}</button></div>}
    {error&&<p role="alert" className="mt-4 text-sm text-[#FF99C4]">{error}</p>}
    <p className="mt-5 text-center text-xs leading-5 text-[#938b97]">{copy.broadcastAds}</p>
    <nav className="mt-3 flex justify-center text-xs text-[#bcb2c3]"><a href={`/${language}/terms-and-conditions`} className="mr-5 underline">{text.terms}</a><a href={`/${language}/privacy-policy`} className="underline">{text.privacy}</a></nav>
   </div>
  </section>
 </main>;
}
