import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
const auth=vi.hoisted(()=>({user:{_id:'fixture-user',fullName:'Ada',email:'ada@example.test'},isAuthenticated:true,isLoading:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>auth}));
vi.mock('@/hooks/useSeoRouting',()=>({useSeoRouting:()=>({currentLanguage:'en',getLocalizedUrl:(p:string)=>'/en'+p})}));
import TvLogin from '../src/pages/tv-login';
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
beforeEach(()=>{auth.user={_id:'fixture-user',fullName:'Ada',email:'ada@example.test'};auth.isAuthenticated=true;window.history.replaceState(null,'','/en/tv?code=123456');});
describe('TV pairing confirmation',()=>{
 it('never signs a TV in merely because the QR was opened, and locks duplicate confirmation',async()=>{
  let complete!:(r:Response)=>void;const fetch=vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve;}));vi.stubGlobal('fetch',fetch);
  render(<TvLogin/>);expect(screen.getByLabelText('TV code')).toHaveValue('123456');expect(fetch).not.toHaveBeenCalled();
  const button=screen.getByRole('button',{name:'Sign in on this TV'});fireEvent.click(button);fireEvent.click(button);expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/api/auth/tv/activate');
  await act(async()=>complete(new Response(JSON.stringify({success:true,deviceName:'Samsung TV'}),{status:200})));
  expect(screen.getByRole('heading',{name:'Your TV is connected'})).toBeInTheDocument();expect(window.location.search).toBe('');
 });
 it('times out a stalled request and allows a deliberate retry',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))));
  render(<TvLogin/>);fireEvent.click(screen.getByRole('button',{name:'Sign in on this TV'}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(screen.getByRole('alert')).toHaveTextContent('couldn’t confirm');expect(screen.getByRole('button',{name:'Sign in on this TV'})).toBeEnabled();
 });
 it('does not apply a response to a different account',async()=>{
  let complete!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve;})));
  const result=render(<TvLogin/>);fireEvent.click(screen.getByRole('button',{name:'Sign in on this TV'}));auth.user={...auth.user,_id:'other-account'};result.rerender(<TvLogin/>);
  await act(async()=>complete(new Response(JSON.stringify({success:true,deviceName:'Samsung TV'}),{status:200})));
  expect(screen.queryByRole('heading',{name:'Your TV is connected'})).not.toBeInTheDocument();
 });
 it('keeps the code through sign in and rejects expired codes without exposing server messages',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({message:'internal fixture detail'}),{status:404})));
  const result=render(<TvLogin/>);fireEvent.click(screen.getByRole('button',{name:'Sign in on this TV'}));expect(await screen.findByRole('alert')).toHaveTextContent('expired');expect(screen.getByLabelText('TV code')).toHaveValue('123456');
  auth.isAuthenticated=false;result.rerender(<TvLogin/>);expect(screen.getByRole('link',{name:'Sign in or create an account'})).toHaveAttribute('href','/en/login?returnTo=%2Fen%2Ftv%3Fcode%3D123456');
 });
});
