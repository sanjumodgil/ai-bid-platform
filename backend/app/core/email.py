"""
Email sending — uses SMTP if configured, otherwise no-op with warning.
All outbound email goes through this module so there's one place to check config.
"""
import logging
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

logger = logging.getLogger(__name__)

def _get_smtp_config() -> Optional[dict]:
    """Read SMTP config from integration_config table."""
    try:
        from app.database import engine
        from sqlmodel import Session, select
        from app.models import IntegrationConfig
        import json
        with Session(engine) as session:
            obj = session.exec(
                select(IntegrationConfig).where(IntegrationConfig.name == "smtp")
            ).first()
            if not obj or not obj.enabled or not obj.config_json:
                return None
            cfg = json.loads(obj.config_json)
            if not cfg.get("host"):
                return None
            return cfg
    except Exception as e:
        logger.warning(f"Could not read SMTP config: {e}")
        return None

def is_smtp_configured() -> bool:
    """Quick check — returns True if SMTP is configured and enabled."""
    return _get_smtp_config() is not None

def send_email(to: str, subject: str, body_html: str, body_text: str = "") -> bool:
    """
    Send an email. Returns True if sent, False if not configured or failed.
    Never raises — callers should check the return value.
    """
    cfg = _get_smtp_config()
    if not cfg:
        logger.info(f"SMTP not configured — email to {to} suppressed. Subject: {subject}")
        return False

    try:
        host     = cfg["host"]
        port     = int(cfg.get("port", 587))
        user     = cfg.get("user", "")
        password = cfg.get("password", "")
        from_addr = cfg.get("from_address") or user

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = from_addr
        msg["To"]      = to

        if body_text:
            msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))

        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=10) as server:
            server.ehlo()
            if port == 587:
                server.starttls(context=context)
                server.ehlo()
            if user and password:
                server.login(user, password)
            server.sendmail(from_addr, [to], msg.as_string())

        logger.info(f"Email sent to {to}: {subject}")
        return True

    except Exception as e:
        logger.error(f"Failed to send email to {to}: {e}")
        return False

def send_password_reset_email(to: str, token: str, platform_name: str = "AI-Powered Bid Platform") -> bool:
    subject   = f"Password reset — {platform_name}"
    body_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#C8A882">{platform_name}</h2>
      <p>You requested a password reset. Use the token below:</p>
      <div style="background:#f5f0eb;padding:16px;border-radius:8px;font-family:monospace;font-size:14px;word-break:break-all">
        {token}
      </div>
      <p>This token expires in <strong>1 hour</strong>.</p>
      <p style="color:#999;font-size:12px">If you didn't request this, ignore this email.</p>
    </div>"""
    body_text = f"Password reset token:\n\n{token}\n\nExpires in 1 hour."
    return send_email(to, subject, body_html, body_text)


def send_review_assignment_email(to: str, reviewer_name: str, section_title: str,
                                  opportunity_name: str, app_url: str = "") -> bool:
    subject   = f"Review assigned: {section_title} — {opportunity_name}"
    body_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#C8A882">Review Assignment</h2>
      <p>Hi {reviewer_name},</p>
      <p>You have been assigned to review a bid section:</p>
      <div style="background:#f5f0eb;padding:16px;border-radius:8px;margin:16px 0">
        <p style="margin:0"><strong>Opportunity:</strong> {opportunity_name}</p>
        <p style="margin:8px 0 0"><strong>Section:</strong> {section_title}</p>
      </div>
      {f'<p><a href="{app_url}" style="color:#C8A882">Open in Bid Platform →</a></p>' if app_url else ''}
    </div>"""
    body_text = f"Hi {reviewer_name},\n\nYou have been assigned to review:\n{opportunity_name} — {section_title}\n\n{app_url}"
    return send_email(to, subject, body_html, body_text)


def send_deadline_reminder_email(to: str, recipient_name: str, opportunity_name: str,
                                  deadline_str: str, days_left: int, app_url: str = "") -> bool:
    urgency   = "🔴 URGENT" if days_left <= 2 else "⚠️ Reminder"
    subject   = f"{urgency}: {opportunity_name} deadline in {days_left} day{'s' if days_left != 1 else ''}"
    body_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:{'#d32f2f' if days_left <= 2 else '#C8A882'}">{urgency}: Submission Deadline</h2>
      <p>Hi {recipient_name},</p>
      <div style="background:#f5f0eb;padding:16px;border-radius:8px;margin:16px 0">
        <p style="margin:0"><strong>Opportunity:</strong> {opportunity_name}</p>
        <p style="margin:8px 0 0"><strong>Deadline:</strong> {deadline_str}</p>
        <p style="margin:8px 0 0"><strong>Days remaining:</strong> {days_left}</p>
      </div>
      {f'<p><a href="{app_url}" style="color:#C8A882">Open in Bid Platform →</a></p>' if app_url else ''}
    </div>"""
    body_text = f"{opportunity_name} deadline: {deadline_str} ({days_left} days remaining)\n\n{app_url}"
    return send_email(to, subject, body_html, body_text)


def send_capture_result_email(to: str, recipient_name: str, opportunity_name: str,
                               result: str, score: str = "", app_url: str = "") -> bool:
    icon    = "🏆" if result in ("won", "won_at_orals") else "📋"
    subject = f"{icon} Bid result: {result.replace('_', ' ').title()} — {opportunity_name}"
    body_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#C8A882">{icon} Bid Result Captured</h2>
      <p>Hi {recipient_name},</p>
      <div style="background:#f5f0eb;padding:16px;border-radius:8px;margin:16px 0">
        <p style="margin:0"><strong>Opportunity:</strong> {opportunity_name}</p>
        <p style="margin:8px 0 0"><strong>Result:</strong> {result.replace('_', ' ').title()}</p>
        {f'<p style="margin:8px 0 0"><strong>Score:</strong> {score}</p>' if score else ''}
      </div>
      <p>Remember to add lessons learned to the Knowledge Base.</p>
      {f'<p><a href="{app_url}" style="color:#C8A882">Open in Bid Platform →</a></p>' if app_url else ''}
    </div>"""
    return send_email(to, subject, body_html, body_text=f"{opportunity_name} — {result}")

