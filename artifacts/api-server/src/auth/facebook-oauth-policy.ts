import {createHash,timingSafeEqual} from 'node:crypto';
export const FACEBOOK_MOBILE_REDIRECT='megaradio://facebook-auth';
export function facebookCallbackUrl(env:NodeJS.ProcessEnv=process.env){
  return env.FACEBOOK_CALLBACK_URL||'https://api.themegaradio.com/api/auth/facebook/callback';
}
export function facebookProof(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);}
export function facebookVerifier(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9._~-]{43,128}$/.test(value);}
export function facebookHash(value:string){return createHash('sha256').update(value).digest('base64url');}
export function validFacebookState(expected:unknown,actual:unknown,started:unknown,now=Date.now()){
  return typeof expected==='string'&&typeof actual==='string'&&/^[a-f0-9]{64}$/.test(expected)&&/^[a-f0-9]{64}$/.test(actual)&&typeof started==='number'&&now>=started&&now-started<=10*60*1000&&timingSafeEqual(Buffer.from(expected),Buffer.from(actual));
}
