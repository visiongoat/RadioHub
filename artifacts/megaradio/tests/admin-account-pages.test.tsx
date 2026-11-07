import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient, getQueryFn } from '../src/lib/queryClient';
import { adminDateRange, formatAdminMoney } from '../src/lib/admin-account-utils';
import PaddlePlans from '../src/pages/admin/paddle-plans';
import StripePlans from '../src/pages/admin/stripe-plans';
import TvVersion from '../src/pages/admin/tv-version';
import Feedback from '../src/pages/admin/feedback';
import ApiKeys from '../src/pages/admin/api-keys';
import Sales from '../src/pages/admin/sales-analytics';
import IapEvents from '../src/pages/admin/iap-events';
import AdminUsers from '../src/pages/admin/admin-users';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../src/hooks/use-toast', () => ({ useToast: () => ({ toast }), toast }));
vi.mock('../src/hooks/useAdminViewPrefs', () => ({ useAdminViewPrefs: (_key: string, defaults: any) => {
  const [prefs, setPrefs] = React.useState(defaults);
  return { prefs, setPrefs, reset: () => setPrefs(defaults), loaded: true };
} }));
vi.mock('../src/pages/admin/AdminPage', () => ({ AdminPage: ({ title, children, actions }: any) => <section><h1>{title}</h1>{actions}{children}</section> }));
const plans = ['remove_ads', 'premium_monthly', 'premium_yearly', 'premium_lifetime'].map(planId => ({ planId, stripePriceId: 'price_original', paddlePriceId: 'pri_original', label: planId, description: 'Existing plan', amount: 500, currency: 'eur', isActive: true }));
const config = { latest: { ios: '1.0.0' }, minimum: {}, storeUrl: {}, releaseNotes: { en: 'Saved notes', de: 'Bestehender Text' } };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  queryClient.clear(); toast.mockReset();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: Infinity, gcTime: Infinity, queryFn: getQueryFn({ on401: 'throw' }) }, mutations: { retry: false } });
  fetchMock = vi.fn(async () => Response.json({ plans })); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); queryClient.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(Page: React.ComponentType) { return render(<QueryClientProvider client={queryClient}><Page /></QueryClientProvider>); }

it.each([[PaddlePlans, 'payment plans'], [StripePlans, 'payment plans'], [TvVersion, 'version configuration'], [Feedback, 'Feedback could not'], [Sales, 'Sales data could not']] as const)('blocks fabricated empty settings/reports after a failed read (%s)', async (Page, text) => {
  fetchMock.mockResolvedValue(new Response('Unavailable', { status: 503 }));
  mount(Page);
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
  expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  expect(fetchMock.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
});

it.each([[PaddlePlans, 'Paddle', 'paddlePriceId'], [StripePlans, 'Stripe', 'stripePriceId']] as const)('discards cancelled %s drafts and ignores late verification for another price', async (Page, provider, field) => {
  queryClient.setQueryData(['/api/admin/stripe-plans'], { plans });
  const pending = deferred<Response>();
  fetchMock.mockImplementation((_url: string, init: RequestInit) => init?.method === 'POST' ? pending.promise : Promise.resolve(Response.json({ plans })));
  mount(Page); fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  const input = screen.getByLabelText(`${provider} Price ID`);
  fireEvent.change(input, { target: { value: provider === 'Paddle' ? 'pri_old' : 'price_old' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.change(input, { target: { value: provider === 'Paddle' ? 'pri_new' : 'price_new' } });
  await act(async () => pending.resolve(Response.json({ valid: true, unitAmount: 99999, currency: 'usd', active: true })));
  expect(screen.queryByText(/Valid ·/)).toBeNull();
  if (provider === 'Stripe') expect(screen.getByLabelText('Amount in smallest currency unit')).toHaveValue(500);
  fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  expect(screen.getByLabelText(`${provider} Price ID`)).toHaveValue(plans[0][field]);
});

it('saves a verified zero-price Paddle value and locks the pending draft', async () => {
  queryClient.setQueryData(['/api/admin/stripe-plans'], { plans });
  const pending = deferred<Response>();
  fetchMock.mockImplementation((_url: string, init: RequestInit) => init?.method === 'POST' ? Promise.resolve(Response.json({ valid: true, unitAmount: 0, currency: 'EUR', active: true })) : init?.method === 'PUT' ? pending.promise : Promise.resolve(Response.json({ plans })));
  mount(PaddlePlans); fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByText(/€0.00/);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByLabelText('Paddle Price ID')).toBeDisabled());
  const call = fetchMock.mock.calls.find(call => call[1]?.method === 'PUT')!;
  expect(JSON.parse(call[1].body)).toEqual({ paddlePriceId: 'pri_original', amount: 0, currency: 'eur' });
  await act(async () => pending.resolve(Response.json({ success: true, plan: plans[0] })));
});

it('protects dirty TV config from refetch, preserves other locales and locks a pending save', async () => {
  queryClient.setQueryData(['/api/admin/tv-version'], config);
  const pending = deferred<Response>(); fetchMock.mockReturnValue(pending.promise);
  mount(TvVersion);
  expect(screen.getByRole('button', { name: 'Save Config' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('ios latest version'), { target: { value: '2.0.0' } });
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  await act(async () => { queryClient.setQueryData(['/api/admin/tv-version'], { ...config, latest: { ios: '9.0.0' } }); });
  expect(screen.getByLabelText('ios latest version')).toHaveValue('2.0.0');
  fireEvent.click(screen.getByRole('button', { name: 'Save Config' }));
  await waitFor(() => expect(screen.getByLabelText('ios latest version')).toBeDisabled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).releaseNotes.de).toBe('Bestehender Text');
  await act(async () => pending.resolve(Response.json({ ...config, latest: { ios: '2.0.0' } })));
});

it('isolates feedback drafts across records and tolerates historical invalid dates', async () => {
  const feedback = ['A', 'B'].map(_id => ({ _id, subject: `Feedback ${_id}`, type: 'bug', status: 'open', message: 'A report', createdAt: 'invalid' }));
  fetchMock.mockResolvedValue(Response.json({ feedback, stats: { total: 2 } }));
  mount(Feedback); await screen.findByRole('button', { name: 'View feedback: Feedback A' });
  expect(screen.getAllByText('Unknown date')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'View feedback: Feedback A' }));
  fireEvent.change(screen.getByLabelText('Admin response'), { target: { value: 'Private draft A' } });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'View feedback: Feedback B' }));
  expect(screen.getByLabelText('Admin response')).toHaveValue('');
  expect(fetchMock.mock.calls.every(call => call[1]?.method === 'GET')).toBe(true);
});

it('reports API key query failures and does not display invented empty records', async () => {
  fetchMock.mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  mount(ApiKeys);
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(screen.queryByText('No developers found.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'API Keys' }));
  await screen.findByText(/API keys could not be loaded/);
});

it('invalidates every API key/developer filter after changes and prevents concurrent row writes', async () => {
  const key = { _id: 'key-fixture', keyPrefix: 'public-prefix', email: 'fixture@example.invalid', plan: 'free', status: 'active', usage: {}, dailyQuota: 100 };
  const pending = deferred<Response>();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => init?.method === 'POST' ? pending.promise : Promise.resolve(Response.json(url.includes('/stats') ? { requests: {}, byPlan: {} } : url.includes('/keys?') ? { keys: [key], pages: 1 } : { users: [], pages: 1 })));
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries');
  mount(ApiKeys); fireEvent.click(screen.getByRole('button', { name: 'API Keys' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pro' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled());
  await act(async () => pending.resolve(Response.json({ success: true, key })));
  await waitFor(() => expect(invalidated).toHaveBeenCalledWith({ queryKey: ['/api/admin/api-keys/users'] }));
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['/api/admin/api-keys/keys'] });
});

it('uses inclusive UTC dates, disables inverted sales ranges and never reports currencies as a combined value', async () => {
  fetchMock.mockImplementation(async () => Response.json({ summary: { revenueByCurrency: [{ currency: 'eur', amount: 500 }, { currency: 'usd', amount: 900 }] }, timeline: [], byPlan: [], recentSales: [] }));
  mount(Sales); await screen.findByText('€5.00'); expect(screen.getByText('$9.00')).toBeTruthy();
  const query = new URL(String(fetchMock.mock.calls[0][0]), 'https://example.invalid').searchParams;
  expect(query.get('to')).toMatch(/T23:59:59\.999Z$/);
  fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2099-01-01' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Choose valid dates');
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
});

it('validates IAP date ranges before applying and makes failed summary distinct from loading', async () => {
  fetchMock.mockImplementation(async (url: string) => url.includes('/stats') ? new Response('Unavailable', { status: 503 }) : Response.json({ items: [], total: 0, page: 1 }));
  mount(IapEvents); await screen.findByText(/Summary unavailable/);
  fireEvent.change(screen.getByLabelText('From date (UTC)'), { target: { value: '2026-09-12' } });
  fireEvent.change(screen.getByLabelText('To date (UTC)'), { target: { value: '2026-09-11' } });
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
});

it('rejects impossible dates and safely formats zero/malformed amounts', () => {
  expect(adminDateRange('2026-02-30', '2026-03-01').valid).toBe(false);
  expect(adminDateRange('2024-02-29', '2024-02-29')).toEqual({ valid: true, from: '2024-02-29T00:00:00.000Z', to: '2024-02-29T23:59:59.999Z' });
  expect(formatAdminMoney(0, 'eur')).toBe('€0.00');
  expect(formatAdminMoney(100, 'invalid')).toBe('—');
});

it('edits only user name/email, handles invalid legacy expiry and locks conflicting actions while saving', async () => {
  const user = { _id: 'fixture-user', fullName: 'Test User', email: 'fixture@example.invalid', favorites: 0, followers: 0,
    subscription: { plan: 'premium_monthly', platform: 'paddle', isActive: true, expiresAt: 'invalid' }, isActive: true };
  const pending = deferred<Response>();
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => init?.method === 'PATCH' ? pending.promise : Promise.resolve(Response.json({ users: [user], total: 1, totalPages: 1 })));
  mount(AdminUsers); fireEvent.click(await screen.findByTitle('Edit user'));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: ' Updated User ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(screen.getByLabelText('Full name')).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Grant lifetime' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeDisabled();
  const call = fetchMock.mock.calls.find(call => call[1]?.method === 'PATCH')!;
  expect(JSON.parse(call[1].body)).toEqual({ fullName: 'Updated User', email: 'fixture@example.invalid' });
  await act(async () => pending.resolve(Response.json({ ...user, fullName: 'Updated User' })));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('cleans up user-column drag listeners and global styles when navigating away', async () => {
  fetchMock.mockResolvedValue(Response.json({ users: [], total: 0, totalPages: 1 }));
  const user = { _id: 'fixture', email: 'fixture@example.invalid', fullName: 'Test', favorites: 0, followers: 0 };
  fetchMock.mockResolvedValue(Response.json({ users: [user], total: 1, totalPages: 1 }));
  const view = mount(AdminUsers);
  const handle = await screen.findByRole('separator', { name: 'Resize name column' });
  fireEvent.mouseDown(handle, { button: 0, clientX: 20 });
  expect(document.body.style.cursor).toBe('col-resize');
  view.unmount();
  expect(document.body.style.cursor).toBe(''); expect(document.body.style.userSelect).toBe('');
});

it('pages through the complete feedback queue and recovers after the last page becomes empty', async () => {
  let shrunk = false;
  fetchMock.mockImplementation(async (url: string) => {
    const page = Number(new URL(url, 'https://example.invalid').searchParams.get('page'));
    return Response.json({ feedback: [{ _id: `report-${page}`, subject: `Report page ${page}`, type: 'bug', status: 'open', message: 'Report', createdAt: '2026-09-01' }],
      total: shrunk ? 50 : 51, totalPages: shrunk ? 1 : 2, stats: { total: shrunk ? 50 : 51 } });
  });
  mount(Feedback); await screen.findByText('Report page 1');
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Report page 2'); expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  expect(fetchMock.mock.calls.some(call => String(call[0]).includes('page=2&limit=50'))).toBe(true);
  shrunk = true;
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ['/api/admin/feedback'] }); });
  await screen.findByText('Report page 1'); expect(screen.queryByRole('navigation', { name: 'Feedback pages' })).toBeNull();
});

it('saves feedback responses without changing status and can reopen a resolved report', async () => {
  const report = { _id: 'resolved', subject: 'Resolved report', type: 'bug', status: 'resolved', message: 'Report', createdAt: '2026-09-01' };
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'PATCH' ? report : { feedback: [report] }));
  mount(Feedback); fireEvent.click(await screen.findByRole('button', { name: 'View feedback: Resolved report' }));
  expect(screen.getByRole('button', { name: 'Save Response' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Admin response'), { target: { value: ' Follow-up answer ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Response' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === 'PATCH')![1].body)).toEqual({ status: 'resolved', response: 'Follow-up answer' });
  fireEvent.click(screen.getByRole('button', { name: 'View feedback: Resolved report' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const changes = fetchMock.mock.calls.filter(call => call[1]?.method === 'PATCH');
  expect(JSON.parse(changes[1][1].body)).toEqual({ status: 'open' });
});

it.each([[AdminUsers, { users: [], total: 0, totalPages: 1 }], [ApiKeys, { users: [], requests: {}, byPlan: {}, pages: 1 }], [IapEvents, { items: [], total: 0, byResult: {} }]] as const)('authenticates custom admin reads (%s)', async (Page, payload) => {
  sessionStorage.setItem('_mrt_oat', 'fixture-session');
  try {
    fetchMock.mockImplementation(async () => Response.json(payload)); mount(Page);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer fixture-session');
      expect(init.credentials).toBe('include'); expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  } finally { sessionStorage.removeItem('_mrt_oat'); }
});

it('downloads CSV with authentication and keeps export errors on the users page', async () => {
  const user = { _id: 'fixture', email: 'fixture@example.invalid', fullName: 'Test', favorites: 0, followers: 0 };
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const create = vi.fn(() => 'blob:fixture');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  sessionStorage.setItem('_mrt_oat', 'fixture-session');
  try {
    fetchMock.mockImplementation(async (url: string) => url.includes('export.csv') ? new Response('email\nfixture@example.invalid', { headers: { 'content-type': 'text/csv' } }) : Response.json({ users: [user], total: 100, totalPages: 2 }));
    mount(AdminUsers); await screen.findByText('fixture@example.invalid'); fireEvent.click(screen.getByRole('button', { name: 'Download filtered users as CSV' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalled();
    const call = fetchMock.mock.calls.find(call => String(call[0]).includes('export.csv'))!;
    expect(new Headers(call[1].headers).get('authorization')).toBe('Bearer fixture-session');
    expect(screen.getByRole('button', { name: 'Download current page as Excel' })).toBeTruthy();
    fetchMock.mockResolvedValue(new Response('Unavailable', { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: 'Download filtered users as CSV' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'CSV export unavailable' })));
    expect(download).toHaveBeenCalledTimes(1);
  } finally { sessionStorage.removeItem('_mrt_oat'); }
});

it.each([['API keys', ApiKeys], ['IAP events', IapEvents]] as const)('returns to the last available page when refreshed records shrink (%s)', async (_name, Page) => {
  let shrunk = false;
  fetchMock.mockImplementation(async (url: string) => {
    const stats = { requests: {}, byPlan: {}, byResult: {} };
    if (url.includes('/stats')) return Response.json(stats);
    return Response.json({ users: [], keys: [], items: [], total: shrunk ? 1 : 51, totalCount: shrunk ? 1 : 51, pages: shrunk ? 1 : 2 });
  });
  mount(Page);
  if (Page === ApiKeys) fireEvent.click(screen.getByRole('button', { name: 'API Keys' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('page=2'))).toBe(true));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled());
  shrunk = true; fetchMock.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('page=1'))).toBe(true));
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});

it('shows expired TV/admin access accurately while retaining historical purchase identifiers', async () => {
  const user = { _id: 'expired-tv-user', fullName: 'Expired TV Demo', email: 'tv-fixture@example.invalid',
    subscription: { plan: 'premium_monthly', platform: 'admin', isActive: true, expiresAt: '2020-01-01T00:00:00Z', productId: 'historical-lifetime', originalTransactionId: 'historical-transaction' } };
  fetchMock.mockResolvedValue(Response.json({ users: [user], total: 1, totalPages: 1 }));
  mount(AdminUsers);fireEvent.click(await screen.findByTitle('Edit user'));
  const dialog=screen.getByRole('dialog');
  expect(within(dialog).getByText('Effective access').parentElement).toHaveTextContent('No');
  expect(within(dialog).getByText(/This is an admin entitlement/)).toHaveTextContent('not a verified store purchase');
  expect(within(dialog).getByText('historical-transaction')).toBeTruthy();
  expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
  expect(within(dialog).getByRole('button',{name:'Cancel subscription'})).toBeDisabled();
});
