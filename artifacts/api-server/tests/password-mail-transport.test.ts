import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passwordMailTransport, sendPasswordResetEmail } from '../src/services/password-reset-mail';

test('Resend is preferred when both credentials exist', () => {
  const previousResend = process.env.RESEND_API_KEY;
  const previousSendGrid = process.env.SENDGRID_API_KEY;
  try {
    process.env.RESEND_API_KEY = ' re_test ';
    process.env.SENDGRID_API_KEY = 'SG.test';
    assert.deepEqual(passwordMailTransport(), { provider: 'resend', apiKey: 're_test' });
    delete process.env.RESEND_API_KEY;
    assert.deepEqual(passwordMailTransport(), { provider: 'sendgrid', apiKey: 'SG.test' });
  } finally {
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    if (previousSendGrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = previousSendGrid;
  }
});

test('Resend gets the localized password email and the original setup link', async context => {
  const send = context.mock.method(globalThis, 'fetch', async () => new Response('{"id":"test-id"}'));
  await sendPasswordResetEmail({ provider: 'resend', apiKey: 're_test' }, 'fixture@example.com', 'test-token', 'tr-TR', 'setup');
  const [url, request] = (send.mock.calls[0].arguments as unknown[]) as [string, RequestInit];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(request.method, 'POST');
  assert.equal(new Headers(request.headers).get('authorization'), 'Bearer re_test');
  const mail = JSON.parse(String(request.body));
  assert.match(mail.from, /^MegaRadio <[^>]+>$/);
  assert.deepEqual(mail.to, ['fixture@example.com']);
  assert.equal(mail.subject, 'MegaRadio şifreni oluştur');
  assert.match(mail.text, /https:\/\/themegaradio\.com\/reset-password\?token=test-token&mode=setup/);
  assert.match(mail.html, /lang="tr"/);
});

test('Resend rejection is surfaced without logging provider data', async context => {
  context.mock.method(globalThis, 'fetch', async () => new Response('provider payload', { status: 403 }));
  await assert.rejects(
    sendPasswordResetEmail({ provider: 'resend', apiKey: 're_test' }, 'fixture@example.com', 'test-token'),
    { code: 403, message: 'Password reset mail was not accepted' },
  );
});
