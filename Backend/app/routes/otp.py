import logging

from fastapi import APIRouter, HTTPException, status

from ..config import get_settings
from ..schemas import OtpSendRequest, OtpSendResponse, OtpVerifyRequest, OtpVerifyResponse
from ..services import delivery, otp

log = logging.getLogger(__name__)
# Deliberately no require_firebase: codes live in memory and are sent by SMTP/Twilio,
# so this works on a fresh checkout with no serviceAccountKey.json.
router = APIRouter(prefix="/auth/otp", tags=["otp"])


@router.post("/send", response_model=OtpSendResponse)
def send_otp(body: OtpSendRequest):
    settings = get_settings()
    kind, key = otp.normalize_identifier(body.identifier)
    code = otp.issue(key)
    common = {"identifier_type": kind, "expires_in": settings.otp_ttl_seconds,
              "resend_in": settings.otp_resend_seconds}

    channel = delivery.deliver(kind, key, code)
    if channel is not None:
        where = "by email" if channel == "email" else "by SMS"
        return OtpSendResponse(message=f"A verification code has been sent {where}.",
                               channel=channel, delivered=True, **common)

    if not settings.otp_dev_fallback:
        otp.discard(key, code)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "OTP_DELIVERY_FAILED",
                    "message": "Could not send the verification code. Try again later."},
        )

    log.warning("DEV MODE: could not deliver the code for %s, handing it back to the app: %s", key, code)
    return OtpSendResponse(message="Development mode: the code could not be sent, so it is shown on screen.",
                           channel="screen", delivered=False, dev_code=code, **common)


@router.post("/verify", response_model=OtpVerifyResponse)
def verify_otp(body: OtpVerifyRequest):
    _, key = otp.normalize_identifier(body.identifier)
    otp.verify(key, body.code)
    return OtpVerifyResponse(verified=True, message="Code verified.")
