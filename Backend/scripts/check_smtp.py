"""Verify SMTP connectivity and authentication without sending email.
Run from Backend: python -m scripts.check_smtp
"""
import smtplib
import ssl
import sys

from app.config import get_settings


def main() -> int:
    settings = get_settings()
    if not settings.smtp_host or not (settings.smtp_from or settings.smtp_username):
        print("FAIL SMTP: set SMTP_HOST and SMTP_FROM or SMTP_USERNAME in Backend/.env.")
        return 1
    if settings.smtp_host == "smtp-relay.brevo.com" and not (settings.smtp_username and settings.smtp_password):
        print("FAIL SMTP: set the Brevo SMTP login and SMTP key in Backend/.env.")
        return 1
    if settings.smtp_username and not settings.smtp_password:
        print("FAIL SMTP: set SMTP_PASSWORD locally to the provider's SMTP/app password.")
        return 1
    try:
        context = ssl.create_default_context()
        connection = (
            smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10, context=context)
            if settings.smtp_use_ssl else
            smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
        )
        with connection as smtp:
            smtp.ehlo()
            if settings.smtp_use_tls and not settings.smtp_use_ssl:
                smtp.starttls(context=context)
                smtp.ehlo()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            code, _ = smtp.noop()
            if code != 250:
                raise RuntimeError("SMTP health check failed")
    except Exception as exc:
        print(f"FAIL SMTP: {type(exc).__name__}. Check host, port, TLS mode and credentials.")
        return 1
    status = "connected and authenticated" if settings.smtp_username else "connected; authentication not configured"
    print(f"PASS SMTP: {status}; no email sent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
