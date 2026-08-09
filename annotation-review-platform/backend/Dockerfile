FROM python:3.12-slim

# System deps for Shapely / lxml / psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgeos-dev \
        libxml2-dev \
        libxslt-dev \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Alembic config expects to find alembic.ini at /app/alembic.ini
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
