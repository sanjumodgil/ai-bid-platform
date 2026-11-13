# AI-Powered Bid Platform

Enterprise bid intelligence platform — 16-stage pipeline from opportunity registration through oral delivery, with full knowledge base learning loop.

**Tech stack:** React 18 + TypeScript 5 + Vite · FastAPI (Python 3.13) · SQLite/PostgreSQL · ChromaDB/pgvector · sentence-transformers

---

## What's built

### Stage pipeline

| Stage | Name | Description |
|---|---|---|
| 1 | Register opportunity | Client, industry, vertical, deadline, procurement reference |
| 2 | Ingest documents | PDF, DOCX, XLSX → chunk → embed → vector DB |
| 3 | Go / No-Go gate | CFAV scoring across 5 dimensions, bid lead confirms |
| 4 | Generate RFP response | RAG loop, SSE streaming section-by-section |
| 5 | Confidence triage | 4-dimension scoring (completeness, relevance, tone, risk) |
| 6 | HITL review | Assign reviewers, annotate, approve, inline edit |
| 7 | Pre-export compliance | 6 automated checks — pass / warn / fail |
| 8 | Export | Word .docx (default + custom template) + PPTX summary |
| 9 | Submit | Method, confirmation reference, status update |
| 10 | Capture result | Won / lost / shortlisted, score, evaluator feedback |
| 11 | Oral setup | Date, venue, format, evaluator panel, presenter team |
| 12 | Presentation deck | AI proposes structure, bid lead edits, AI generates talking points, PPTX export |
| 13 | Q&A anticipation | Configurable count (10/20/30), 6 categories, model answers |
| 14 | Rehearsal tracking | Log sessions, readiness score 0–100, auto-recalculated |
| 15 | Oral delivery | Post-oral notes, evaluator feedback, result capture |
| 16 | KB learning loop | Promote docs, lessons learned, flag insights for future bids |

### Core features
- **Knowledge Base** — upload, index, semantic search, opportunity linkage, 12 industry verticals / 60+ sub-domains, contributors, lessons learned, flagged lessons surfacing on new bids
- **Bid Team** — Azure AD search or manual entry, role assignment
- **Settings** — LLM configuration (6 providers + test connection), SMTP email, Azure AD, embedding model per provider, infrastructure visibility panel, audit log
- **Dashboard** — live stats, my-reviews queue, upcoming deadlines, sidebar badge
- **Security** — API key encryption at rest (Fernet AES), JWT auth, rate limiting
- **Notifications** — email on review assignment, bid result, upcoming deadlines (APScheduler daily)
- **Exports** — Word .docx RFP response, PPTX RFP summary, PPTX oral presentation deck with speaker notes

---

## Quick start

```bash
# 1. Copy env templates
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env.local

# 2. Start everything
docker compose up --build          # dev profile (SQLite + local storage)
docker compose --profile postgres up   # staging (PostgreSQL)
docker compose --profile full up       # production (PostgreSQL + Redis + Celery)

# 3. Open browser
open http://localhost:5180
```

On first launch the platform opens a setup wizard — create the admin account and configure your LLM provider.

---

## Manual setup (without Docker)

Requires: Python 3.13, Node 20+

### Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # Mac/Linux

pip install -r requirements.txt

cp .env.example .env            # edit as needed
python run.py
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

### Optional: Celery worker (for async document ingestion)
```bash
cd backend
source .venv/bin/activate
celery -A app.celery_app worker --loglevel=info
# Windows: add --pool=solo
```

> Redis is optional. If Redis is running, the platform auto-detects it and uses Celery. If not, document ingestion runs synchronously (fine for dev/POC).

---

## Infrastructure — swap without code changes

All infrastructure is configured via `.env`. No source code changes required.

| Component | Default (dev) | Production options |
|---|---|---|
| **Database** | SQLite | PostgreSQL, Azure SQL |
| **Vector DB** | ChromaDB | pgvector, Azure AI Search, Pinecone, Weaviate, Qdrant |
| **File storage** | Local disk | Azure Blob Storage, AWS S3 |
| **Auth** | Local JWT | Azure AD SSO, SAML 2.0 |
| **Secrets** | DB plaintext | Env vars, Azure Key Vault, HashiCorp Vault |
| **Jobs** | Auto (sync→Celery) | Celery + Redis, Azure Service Bus |

See `backend/.env.example` for all options with copy-paste connection strings.

### Docker Compose profiles

```bash
docker compose up                        # Dev: SQLite + local storage
docker compose --profile postgres up     # Staging: PostgreSQL
docker compose --profile full up         # Production: PostgreSQL + Redis + Celery worker
```

---

## Environment reference

### Backend — `backend/.env`

| Variable | Default | Description |
|---|---|---|
| `ENVIRONMENT` | `development` | `development` / `staging` / `production` |
| `PORT` | `8010` | Backend API port |
| `CORS_ORIGINS` | `http://localhost:5180` | Comma-separated allowed frontend origins |
| `SECRET_KEY` | auto-generated | JWT + encryption key — generate a strong one for production |
| `DATABASE_URL` | `sqlite:///./bidplatform.db` | Swap to `postgresql://...` for production |
| `VECTOR_DB_BACKEND` | `chroma` | `chroma` / `pgvector` / `azure_ai_search` / `pinecone` / `weaviate` / `qdrant` |
| `STORAGE_BACKEND` | `local` | `local` / `azure_blob` / `s3` |
| `AUTH_BACKEND` | `local` | `local` / `azure_ad` / `saml` |
| `SECRETS_BACKEND` | `db` | `db` / `env` / `azure_keyvault` / `hashicorp_vault` |
| `JOBS_BACKEND` | `auto` | `auto` (Redis if available, else sync) / `celery_redis` / `sync` |
| `RATE_LIMIT_ENABLED` | `false` | Set `true` to enable per-IP rate limiting |
| `RATE_LIMIT_PER_MINUTE` | `100` | Requests per IP per minute |

### Frontend — `frontend/.env.local`

| Variable | Default | Description |
|---|---|---|
| `VITE_PORT` | `5180` | Dev server port |
| `VITE_API_URL` | `http://localhost:8010` | Backend API URL |

---

## VS Code

Open the `bidplatform/` folder.

**F5** → "Full stack (Backend + Frontend)" — starts both services.

Or manually:
```
Terminal 1:  cd backend  && python run.py
Terminal 2:  cd frontend && npm run dev
```

---

## API documentation

```
Swagger UI:  http://localhost:8010/api/docs
ReDoc:       http://localhost:8010/api/redoc
```

---

## Database migrations

Schema is auto-created at startup via `SQLModel.metadata.create_all()`.

For schema changes going forward (Alembic):
```bash
alembic revision --autogenerate -m "describe your change"
alembic upgrade head
```
