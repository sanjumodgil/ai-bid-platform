"""
Background scheduler for periodic tasks.
Uses APScheduler — lightweight, no external dependencies.
Runs inside the FastAPI process. For production, move to Celery Beat.

Jobs:
  - deadline_reminders: daily at 08:00 UTC — emails for bids due in 1, 3, 7 days
"""
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)
_scheduler = None


def start_scheduler():
    """Start the background scheduler. Called from app lifespan."""
    global _scheduler
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger

        _scheduler = AsyncIOScheduler(timezone="UTC")
        _scheduler.add_job(
            send_deadline_reminders,
            CronTrigger(hour=8, minute=0),   # 08:00 UTC daily
            id          = "deadline_reminders",
            replace_existing = True,
            misfire_grace_time = 3600,
        )
        _scheduler.start()
        logger.info("Scheduler started — deadline reminders at 08:00 UTC daily")
    except ImportError:
        logger.warning("apscheduler not installed — deadline reminders disabled. Run: pip install apscheduler")
    except Exception as e:
        logger.warning(f"Scheduler failed to start: {e}")


def stop_scheduler():
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


async def send_deadline_reminders():
    """
    Find all active opportunities with deadlines in 1, 3, 7 days
    and email the bid lead if SMTP is configured.
    """
    try:
        from app.database import engine
        from sqlmodel import Session, select
        from app.models import Opportunity, User, OpportunityStatus
        from app.core.email import is_smtp_configured, send_deadline_reminder_email

        if not is_smtp_configured():
            logger.debug("Deadline reminders: SMTP not configured — skipping")
            return

        now           = datetime.utcnow()
        reminder_days = [1, 3, 7]
        sent = 0

        with Session(engine) as session:
            active_opps = session.exec(
                select(Opportunity).where(
                    Opportunity.submission_deadline.isnot(None),
                    Opportunity.status.in_([
                        OpportunityStatus.DRAFT,
                        OpportunityStatus.UNDER_REVIEW,
                    ])
                )
            ).all()

            for opp in active_opps:
                if not opp.submission_deadline:
                    continue
                days_left = (opp.submission_deadline - now).days
                if days_left not in reminder_days:
                    continue

                # Find bid lead
                recipient_email = None
                recipient_name  = "Bid Lead"
                if opp.bid_lead_id:
                    lead = session.get(User, opp.bid_lead_id)
                    if lead and lead.email:
                        recipient_email = lead.email
                        recipient_name  = lead.full_name

                if not recipient_email:
                    continue

                deadline_str = opp.submission_deadline.strftime("%d %B %Y %H:%M UTC")
                ok = send_deadline_reminder_email(
                    to               = recipient_email,
                    recipient_name   = recipient_name,
                    opportunity_name = opp.name,
                    deadline_str     = deadline_str,
                    days_left        = days_left,
                )
                if ok:
                    sent += 1
                    logger.info(f"Deadline reminder sent: {opp.name} ({days_left}d) → {recipient_email}")

        logger.info(f"Deadline reminder job done — {sent} email(s) sent")

    except Exception as e:
        logger.error(f"Deadline reminder job failed: {e}", exc_info=True)
