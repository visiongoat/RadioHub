import React from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import ActivatePage from '../src/pages/activate';
import {getQueryFn} from '../src/lib/queryClient';
const state=vi.hoisted(()=>({user:{_id:'owner',email:'owner@example.test'} as any,checkout:vi.fn(),checkoutOptions:null as any,match:true,code:'pending'}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:state.user,isLoading:false})}));
vi.mock('@/hooks/useTranslation',()=>({useTranslation:()=>({language:'tr'})}));
vi.mock('@/hooks/useSubscriptionCheckout',()=>({useSubscriptionCheckout:(options:any)=>{state.checkoutOptions=options;return {loading:false,error:null,checkout:state.checkout};}}));
vi.mock('@/components/ManageSubscriptionButton',()=>({ManageSubscriptionButton:()=>null}));
let client:QueryClient;const network=vi.fn();
beforeEach(()=>{
 state.user={_id:'owner',email:'owner@example.test'};state.match=true;state.code='pending';state.checkout.mockReset();
 window.history.replaceState({},'','/tr/activate?code=123456&plan=premium_yearly');
 client=new QueryClient({defaultOptions:{queries:{retry:false,queryFn:getQueryFn({on401:'throw'})}}});
 network.mockImplementation(async(url:string)=>Response.json(String(url).includes('/status?')?{status:state.code,accountBound:true,accountMatch:state.match,plan:'premium_yearly'}:{providerAvailable:true,plans:[{planId:'premium_yearly',label:'Annual',amount:2999,currency:'eur',checkoutAvailable:true,billingInterval:'year'},{planId:'premium_monthly',label:'Monthly',amount:499,currency:'eur',checkoutAvailable:true}]}));
 vi.stubGlobal('fetch',network);
});
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals();});
const mount=()=>render(<QueryClientProvider client={client}><ActivatePage/></QueryClientProvider>);
it('preserves exact TV plan and code, showing the paying identity before checkout',async()=>{
 mount();const pay=await screen.findByRole('button',{name:'Ödemeye devam et'});expect((pay as HTMLButtonElement).disabled).toBe(false);
 expect(screen.getByText('owner@example.test')).toBeTruthy();expect(screen.queryByText('Aylık')).toBeNull();
 fireEvent.click(pay);expect(state.checkout).toHaveBeenCalledWith('premium_yearly');expect(state.checkoutOptions.returnTo).toBe('/tr/activate?code=123456&plan=premium_yearly');
});
it('blocks another phone account before showing checkout and offers account switching',async()=>{
 state.match=false;mount();await screen.findByText(/Bu kod TV’deki başka bir hesaba ait/);
 expect(screen.queryByRole('button',{name:'Ödemeye devam et'})).toBeNull();expect(screen.getByRole('button',{name:'Hesap değiştir'})).toBeTruthy();expect(state.checkout).not.toHaveBeenCalled();
});
it('carries the selected plan through phone sign-in rather than opening the app home',async()=>{
 state.user=null;mount();const signIn=await screen.findByRole('link',{name:'Giriş yap ve devam et'});
 expect(decodeURIComponent(signIn.getAttribute('href')!)).toContain('/tr/activate?code=123456&plan=premium_yearly');
});
it('expired or already used QR never offers another payment',async()=>{
 state.code='expired';mount();await screen.findByText('Kodun süresi doldu');expect(screen.queryByRole('button',{name:'Ödemeye devam et'})).toBeNull();expect(state.checkout).not.toHaveBeenCalled();
});

it('offers the installed app with the same TV code and plan, without starting checkout',async()=>{
 mount();const link=await screen.findByRole('link',{name:'MegaRadio uygulamasında devam et'});
 expect(link.getAttribute('href')).toBe('megaradio://activate?code=123456&plan=premium_yearly');
 expect(state.checkout).not.toHaveBeenCalled();
});
