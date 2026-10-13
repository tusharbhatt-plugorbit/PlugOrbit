# PlugOrbit SMTP setup

Recommended OTP provider: Brevo. Relay smtp-relay.brevo.com, port 587, STARTTLS.
Sender: admin@plugorbit.com. Relay settings are saved in Backend/.env; account credentials remain empty.
Set provider credentials only in Backend/.env, which is git-ignored.

Required values: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM.
For STARTTLS: SMTP_USE_TLS=true, SMTP_USE_SSL=false (usually port 587).
For implicit TLS: SMTP_USE_SSL=true (usually port 465); STARTTLS is skipped.
Create a Brevo account and authenticate plugorbit.com using the DNS records it provides.
Verify admin@plugorbit.com as a sender. In Brevo > SMTP, copy the exact SMTP login to
SMTP_USERNAME and the SMTP key (not an API key or your mailbox password) to SMTP_PASSWORD
in Backend/.env.

Official setup: https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP

Run from Backend:

```powershell
python -m scripts.check_smtp
```

This checks connectivity and authentication without sending email. Then restart the
backend and request an email OTP from the app to test delivery to your inbox.
