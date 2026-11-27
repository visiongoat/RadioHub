import SendGrid from '@sendgrid/mail';

export const PASSWORD_RESET_TTL_MS = 60 * 60_000;

type PasswordMailTransport = { provider: 'resend' | 'sendgrid'; apiKey: string };

export function passwordMailTransport(): PasswordMailTransport | undefined {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) return { provider: 'resend', apiKey: resendKey };
  const sendGridKey = process.env.SENDGRID_API_KEY?.trim();
  return sendGridKey ? { provider: 'sendgrid', apiKey: sendGridKey } : undefined;
}

const copy = {
  en: {
    subject: 'Reset your MegaRadio password',
    heading: 'Reset your password',
    intro: 'We received a request to reset the password for your MegaRadio account.',
    button: 'Choose a new password',
    expiry: 'This link expires in one hour and can be used once.',
    ignore: 'You can ignore this email if you didn’t request a password reset.',
  },
  tr: {
    subject: 'MegaRadio şifreni sıfırla',
    heading: 'Şifreni sıfırla',
    intro: 'MegaRadio hesabın için bir şifre sıfırlama isteği aldık.',
    button: 'Yeni şifre belirle',
    expiry: 'Bu bağlantı bir saat geçerlidir ve bir kez kullanılabilir.',
    ignore: 'Bu isteği sen göndermediysen e-postayı silebilirsin.',
  },
  de: {
    subject: 'Dein MegaRadio-Passwort zurücksetzen',
    heading: 'Passwort zurücksetzen',
    intro: 'Wir haben eine Anfrage erhalten, das Passwort für dein MegaRadio-Konto zurückzusetzen.',
    button: 'Neues Passwort wählen',
    expiry: 'Dieser Link ist eine Stunde gültig und kann einmal verwendet werden.',
    ignore: 'Du kannst diese E-Mail ignorieren, wenn du kein neues Passwort angefordert hast.',
  },
};

const setupCopy = {
  en: {
    subject: 'Create your MegaRadio password',
    heading: 'Create your password',
    intro: 'Use this link to create a password for your MegaRadio account.',
    button: 'Create password',
    ignore: 'You can ignore this email if you didn’t request a password.',
  },
  tr: {
    subject: 'MegaRadio şifreni oluştur',
    heading: 'Şifreni oluştur',
    intro: 'MegaRadio hesabın için şifre oluşturmak üzere bu bağlantıyı kullan.',
    button: 'Şifre oluştur',
  },
  de: {
    subject: 'Ein Passwort für dein MegaRadio-Konto erstellen',
    heading: 'Erstelle dein Passwort',
    intro: 'Über diesen Link kannst du ein Passwort für dein MegaRadio-Konto erstellen.',
    button: 'Passwort erstellen',
    ignore: 'Du kannst diese E-Mail ignorieren, wenn du kein Passwort angefordert hast.',
  },
};

export function passwordResetEmail(email: string, token: string, language?: string, purpose: 'setup' | 'reset' = 'reset') {
  const requested = language?.trim().toLowerCase().split(/[-,;]/)[0];
  const locale = requested === 'tr' || requested === 'de' ? requested : 'en';
  const labels = purpose === 'setup' ? { ...copy[locale], ...setupCopy[locale] } : copy[locale];
  const link = new URL('https://themegaradio.com/reset-password');
  link.searchParams.set('token', token);
  if (purpose === 'setup') link.searchParams.set('mode', 'setup');

  return {
    to: email,
    from: { email: process.env.PASSWORD_RESET_FROM?.trim() || 'noreply@themegaradio.com', name: 'MegaRadio' },
    subject: labels.subject,
    text: `${labels.intro}\n\n${labels.button}: ${link.href}\n\n${labels.expiry}\n${labels.ignore}`,
    trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
    html: `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${labels.subject}</title></head>
<body style="margin:0;background:#121212;color:#fff;font-family:Ubuntu,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#121212">
    <tr><td align="center" style="padding:36px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px">
        <tr><td style="padding:0 0 20px;color:#ff4199;font-size:22px;font-weight:bold">MegaRadio</td></tr>
        <tr><td style="background:#1e1e1e;border:1px solid #343434;border-radius:16px;padding:28px 24px">
          <h1 style="margin:0 0 16px;color:#fff;font-size:24px;line-height:30px">${labels.heading}</h1>
          <p style="margin:0 0 24px;color:#dedede;font-size:16px;line-height:24px">${labels.intro}</p>
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td bgcolor="#ff4199" style="border-radius:7px">
              <a href="${link.href}" style="display:inline-block;padding:13px 20px;color:#140611;font-size:15px;font-weight:bold;line-height:20px;text-decoration:none">${labels.button}</a>
            </td>
          </tr></table>
          <p style="margin:22px 0 0;color:#bdbdbd;font-size:14px;line-height:21px">${labels.expiry}</p>
        </td></tr>
        <tr><td style="padding:18px 0 0;color:#bdbdbd;font-size:13px;line-height:20px">${labels.ignore}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

export async function sendPasswordResetEmail(transport: PasswordMailTransport, email: string, token: string, language?: string, purpose: 'setup' | 'reset' = 'reset') {
  const mail = passwordResetEmail(email, token, language, purpose);
  if (transport.provider === 'resend') {
    const { from, to, subject, text, html } = mail;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${transport.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw Object.assign(new Error('Password reset mail was not accepted'), { code: response.status });
    return;
  }
  SendGrid.setApiKey(transport.apiKey);
  const [response] = await SendGrid.send(mail);
  if (response.statusCode !== 202) {
    throw Object.assign(new Error('Password reset mail was not accepted'), { code: response.statusCode });
  }
}
