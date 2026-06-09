# FieldTrix Backend

FastAPI backend foundation for the FieldTrix Media Delivery System.

## Local Commands

Install dependencies:

```bash
pip install -e ".[dev]"
```

Run the API:

```bash
uvicorn app.main:app --reload
```

Run migrations:

```bash
alembic upgrade head
```

