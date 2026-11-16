import {tvReceiverQuery} from '@/lib/safe-auth-return';
import {useEffect,useRef,useState} from 'react';
import {Check,Smartphone,Loader2,ArrowLeft} from 'lucide-react';
import {useAuth} from '@/hooks/useAuth';
import {useSeoRouting} from '@/hooks/useSeoRouting';
import {tvPairingCopy} from '@/lib/tv-pairing-copy';
import './tv-login.css';

export default function TvLogin(){
 const {user,isAuthenticated,isLoading:authLoading}=useAuth(),{currentLanguage,getLocalizedUrl}=useSeoRouting(),c=tvPairingCopy(currentLanguage||'en');
 const preview=import.meta.env.DEV?new URLSearchParams(window.location.search).get('preview'):null;
 const signedIn=preview?preview==='confirm'||preview==='success':isAuthenticated;
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[linked,setLinked]=useState(''),[error,setError]=useState('');
 const lock=useRef(false),request=useRef<AbortController|null>(null),revision=useRef(0),owner=user?._id;
 useEffect(()=>{const values=new URLSearchParams(window.location.search).getAll('code');if(values.length===1&&/^\d{6}$/.test(values[0]))setCode(values[0]);else if(values.length)setError(c.invalid);},[]);
 useEffect(()=>{revision.current++;request.current?.abort();lock.current=false;setBusy(false);setLinked('');setError('');return()=>{revision.current++;request.current?.abort();};},[owner]);
 const initial=new URLSearchParams(window.location.search);
 const binding=code===initial.get('code')?tvReceiverQuery(initial):'';
 const target=code?`?code=${code}${binding}`:'';
 const returnUrl=`${window.location.pathname}${target}`;
 const login=`${getLocalizedUrl('/login')}?returnTo=${encodeURIComponent(returnUrl)}`;
 const signup=`${getLocalizedUrl('/signup')}?returnTo=${encodeURIComponent(returnUrl)}`;
 const confirm=async()=>{
  if(preview||lock.current||code.length!==6||!isAuthenticated||!user)return;
  const run=++revision.current,controller=new AbortController();request.current=controller;lock.current=true;setBusy(true);setError('');
  const timeout=window.setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch('/api/auth/tv/activate',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({code}),signal:controller.signal});const data=await response.json();
   if(run!==revision.current)return;
   if(response.ok&&data.success===true){setLinked(typeof data.deviceName==='string'?data.deviceName:'TV');setCode('');window.history.replaceState(null,'',window.location.pathname);}
   else setError(response.status===400||response.status===404?c.invalid:response.status===429?c.rate:response.status===401?c.guest:c.network);
  }catch{if(run===revision.current)setError(c.network);}finally{window.clearTimeout(timeout);if(run===revision.current){lock.current=false;setBusy(false);}}
 };
 const account=preview?{fullName:'Şahin Yoğurtcu',email:'MegaRadio'}:user as any;
 const success=!!linked||preview==='success';
 return <section className="mega-tv-link" aria-labelledby="tv-link-title">
  <a className="mega-tv-back" href={getLocalizedUrl('/')}><ArrowLeft size={20}/>{c.back}</a>
  <div className="mega-tv-panel">
   <div className="mega-tv-symbol" aria-hidden="true"><img className="mega-tv-frequency" src="/icons/tv-connect/login-frequency.svg" alt=""/><img className="mega-tv-mark" src="/icons/tv-connect/login-mark.svg" alt=""/><img className="mega-tv-cast" src="/icons/tv-connect/mirroring-screen.svg" alt=""/></div>
   <h1 id="tv-link-title" aria-live="polite">{success?c.success:c.title}</h1><p className="mega-tv-subtitle">{success?c.done:c.intro}</p>
   {success?<><div className="mega-tv-account"><img className="mega-tv-device" src="/icons/tv-connect/mirroring-screen.svg" alt=""/><div><strong>{linked||'TV'}</strong><span>{account?.fullName||account?.username||account?.email}</span></div><Check size={22}/></div><a className="mega-tv-primary" href={getLocalizedUrl('/')}>{c.finish}</a></>:<>
    {!signedIn&&<><a className="mega-tv-app" href={`megaradio://tv${target}`}><Smartphone size={21}/>{c.openApp}</a><p className="mega-tv-separator">{c.web}</p></>}
    <form onSubmit={event=>{event.preventDefault();void confirm();}}>
     <label htmlFor="tv-code">{c.code}</label><input id="tv-code" aria-describedby="tv-code-hint" data-testid="tv-pairing-code" value={code} onChange={event=>{if(lock.current)return;setCode(event.target.value.replace(/\D/g,'').slice(0,6));setError('');}} placeholder="000000" inputMode="numeric" autoComplete="off" maxLength={6} pattern="[0-9]{6}" disabled={busy}/>
     <p id="tv-code-hint" className="mega-tv-hint">{c.hint}</p>
     {authLoading&&!preview?<div className="mega-tv-loading" role="status"><Loader2 size={24} className="animate-spin"/></div>:signedIn&&account?<><div className="mega-tv-account"><img className="mega-tv-avatar" src="/icons/tv-connect/empty-avatar.svg" alt=""/><div><span>{c.account}</span><strong>{account.fullName||account.username||account.email}</strong>{account.email&&<span>{account.email}</span>}</div></div><button data-testid="tv-pairing-confirm" className="mega-tv-primary" disabled={busy||code.length!==6} type="submit">{busy?<><Loader2 size={20} className="animate-spin"/>{c.connecting}</>:c.confirm}</button></>:<><p className="mega-tv-hint">{c.guest}</p><a className="mega-tv-primary" href={login}>{c.signIn}</a><a className="mega-tv-signup" href={signup}>{currentLanguage==='tr'?'Hesap oluştur':currentLanguage==='de'?'Konto erstellen':'Create an account'}</a></>}
    </form>
    {signedIn&&<a className="mega-tv-app mega-tv-app-secondary" href={`megaradio://tv${target}`}><Smartphone size={18}/>{c.openApp}</a>}
    {error&&<p className="mega-tv-error" role="alert">{error}</p>}
    <p className="mega-tv-privacy"><span>{c.privacy}</span></p>
   </>}
  </div>
 </section>;
}
