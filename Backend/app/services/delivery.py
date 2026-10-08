"""
Sends a one-time code to the user: by email (SMTP) or by SMS (Twilio).
"""
import logging
import smtplib
import ssl
from email.message import EmailMessage

import httpx

from ..config import Settings, get_settings

log = logging.getLogger(__name__)

# Per socket operation. Kept well inside the app's request timeout (LoginApp otpApi.ts) so a
# slow provider ends in the on-screen fallback from here, not in the app giving up first.
TIMEOUT_SECONDS = 5


def email_configured(settings: Settings) -> bool:
    return bool(settings.smtp_host)


def sms_configured(settings: Settings) -> bool:
    return bool(settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number)


def _message_text(code: str, ttl_seconds: int) -> str:
    minutes = max(1, round(ttl_seconds / 60))
    return (f"Your PlugOrbit verification code is {code}. "
            f"It expires in {minutes} minute{'s' if minutes != 1 else ''}. "
            "If you did not request it, ignore this message.")


def send_email(to: str, code: str) -> None:
    settings = get_settings()
    sender = settings.smtp_from or settings.smtp_username
    if not sender:
        raise RuntimeError("Set SMTP_FROM or SMTP_USERNAME so emails have a sender address.")
    msg = EmailMessage()
    msg["Subject"] = "Your PlugOrbit verification code"
    msg["From"] = sender
    msg["To"] = to
    msg.set_content(_message_text(code, settings.otp_ttl_seconds))
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT_SECONDS) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


def send_sms(to: str, code: str) -> None:
    settings = get_settings()
    url = (f"{settings.twilio_api_base.rstrip('/')}/2010-04-01/Accounts/"
           f"{settings.twilio_account_sid}/Messages.json")
    with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
        resp = client.post(
            url,
            auth=(settings.twilio_account_sid, settings.twilio_auth_token),
            data={"To": to, "From": settings.twilio_from_number,
                  "Body": _message_text(code, settings.otp_ttl_seconds)},
        )
    if resp.status_code >= 300:
        try:
            reason = resp.json().get("message", "")
        except Exception:
            reason = ""
        raise RuntimeError(f"Twilio answered {resp.status_code} {reason}".strip())


def deliver(kind: str, to: str, code: str) -> str | None:
    """Send `code` over the channel that matches the identifier type ("email" or "phone").
    Returns "email" or "sms" when it was sent, or None when that channel is not configured
    or the send failed. The caller decides whether to show the code on screen instead."""
    settings = get_settings()
    channel, configured, send = (
        ("email", email_configured(settings), send_email) if kind == "email"
        else ("sms", sms_configured(settings), send_sms)
    )
    if not configured:
        log.warning("OTP %s delivery is not configured, cannot send a code to %s.", channel, to)
        return None
    try:
        send(to, code)
    except Exception as exc:
        log.warning("OTP %s delivery to %s failed: %s: %s", channel, to, type(exc).__name__, exc)
        return None
    return channel


def log_startup_notice() -> None:
    settings = get_settings()
    log.info("OTP delivery: email %s, SMS %s.",
             "configured" if email_configured(settings) else "not configured",
             "configured" if sms_configured(settings) else "not configured")
    if settings.otp_dev_fallback:
        log.warning("OTP_DEV_FALLBACK is ON: when a login code cannot be emailed or texted it is returned "
                    "in the API response and logged here, so anyone who can call the API can read it. "
                    "Development only, set OTP_DEV_FALLBACK=false for anything else.")
