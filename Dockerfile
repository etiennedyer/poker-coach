# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# System deps (add libpq-dev if using Postgres)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend .

# Expose port uvicorn will listen on
EXPOSE 8080
ENV PORT=8080

# Adjust workers if desired: "--workers 2"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]

