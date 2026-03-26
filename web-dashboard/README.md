# 🔐 Secure Locker — Web Dashboard

A full-stack web dashboard for the **Secure Locker** smart locker management system. Built with a **Flask** (Python) backend and a **React + Vite** frontend, backed by **PostgreSQL**.

---

## 📁 Project Structure

```
web-dashboard/
├── backend/                # Flask API server
│   ├── app.py              # Application factory
│   ├── config.py           # Configuration (reads .env)
│   ├── .env                # Environment variables
│   ├── requirements.txt    # Python dependencies
│   ├── seed_database.py    # Database seeding script
│   ├── create_admin.py     # Utility to create org admins
│   ├── reset_admin_password.py  # Password reset utility
│   ├── migration.sql       # Reference SQL migrations
│   ├── routes/             # API route blueprints
│   ├── models/             # SQLAlchemy models
│   ├── services/           # Business logic layer
│   ├── database/           # DB connection helpers
│   ├── core/               # Logging & core utilities
│   ├── utils/              # Shared utilities
│   └── static/             # Production frontend build output
│
└── frontend/               # React + Vite SPA
    ├── src/
    │   ├── App.jsx          # Root component & routing
    │   ├── main.jsx         # Entry point
    │   ├── pages/           # Page components
    │   ├── components/      # Reusable UI components
    │   └── services/        # API service layer
    ├── package.json
    └── vite.config.js
```

---

## ⚙️ Prerequisites

| Tool           | Version     |
|:-------------- |:----------- |
| **Python**     | 3.10+       |
| **Node.js**    | 18+         |
| **npm**        | 9+          |
| **PostgreSQL** | 14+         |

---

## 🗄️ Database Setup

The system uses **two PostgreSQL databases**:

| Database            | Purpose                                      |
|:------------------- |:-------------------------------------------- |
| `locker_msl_auth`   | Web-only — admin accounts & audit logs       |
| `locker_msl`        | Daemon — organization info & member data     |

### Create the databases

```sql
-- Connect to PostgreSQL as a superuser
psql -U postgres

-- Create the database user
CREATE USER locker_msl WITH PASSWORD 'msl_locker_2025';

-- Create both databases
CREATE DATABASE locker_msl OWNER locker_msl;
CREATE DATABASE locker_msl_auth OWNER locker_msl;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE locker_msl TO locker_msl;
GRANT ALL PRIVILEGES ON DATABASE locker_msl_auth TO locker_msl;
```

---

## 🔧 Environment Variables

The backend reads its configuration from `backend/.env`. A default `.env` is included:

```env
SECRET_KEY=locker-msl-secret-key-2026
JWT_SECRET_KEY=locker-msl-jwt-secret-2026

# Auth DB (web-only: admins + audit_logs)
AUTH_POSTGRES_DB=locker_msl_auth

# Daemon DB (member data)
POSTGRES_DB=locker_msl

# Shared DB connection
POSTGRES_USER=locker_msl
POSTGRES_PASSWORD=msl_locker_2025
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432

# Super admin seed (created on first startup)
SUPER_ADMIN_USERNAME=superadmin
SUPER_ADMIN_PASSWORD=SuperAdmin@2026!
```

> **Note:** Update passwords and secret keys before deploying to production.

---

## 🚀 Installation & Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd web-dashboard
```

### 2. Backend Setup

```bash
# Navigate to the backend directory
cd backend

# Create and activate a virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Frontend Setup

```bash
# Navigate to the frontend directory
cd frontend

# Install Node.js dependencies
npm install
```

---

## 🌱 Database Seeding

After setting up PostgreSQL and creating both databases, seed the initial data:

```bash
# Run from the web-dashboard root directory
cd web-dashboard
python -m backend.seed_database
```

This will:
1. Create auth DB tables (`admins`, `audit_logs`)
2. Seed the **super admin** account from `.env` variables
3. Create a sample organization (**SecureDemo**) in the daemon DB
4. Create an **org admin** for the sample organization

### Default Credentials After Seeding

| Role           | Organization   | Username                 | Password            |
|:-------------- |:-------------- |:------------------------ |:------------------- |
| Super Admin    | MicroSysLogic  | `superadmin`             | `SuperAdmin@2026!`  |
| Org Admin      | SecureDemo     | `admin@securedemo.com`   | `Demo@1234!`        |

---

## ▶️ Running the Application

### Start the Backend (Flask API)

```bash
# From web-dashboard root, with venv activated
python -m backend.app
```

The API server starts at **`http://127.0.0.1:5001`**

### Start the Frontend (Vite Dev Server)

```bash
# In a separate terminal
cd frontend
npm run dev
```

The frontend dev server starts at **`http://localhost:5173`** and proxies `/api` requests to the Flask backend.

### Access the Dashboard

Open **`http://localhost:5173`** in your browser and log in with one of the seeded credentials.

---

## 🏗️ Production Build

To build the frontend for production and serve it through Flask:

```bash
cd frontend
npm run build
```

This outputs optimized static files to `backend/static/`. The Flask server automatically serves them at the root URL.

Then run only the backend:

```bash
python -m backend.app
```

Access the app at **`http://127.0.0.1:5001`**

---

## 🛠️ Utility Scripts

### Create an Org Admin

```bash
# Set environment variables first
set ADMIN_ORG_NAME=vjit
set ADMIN_ORG_CODE=VJIT
set ADMIN_USERNAME=krishna
set ADMIN_PASSWORD=12345678

# Run from web-dashboard root
python -m backend.create_admin
```

### Reset an Admin Password

```bash
python -m backend.reset_admin_password --username admin --password newpass123 --org "Secure Locker"
```

### Run SQL Migrations (Manual)

```bash
psql -U postgres -d secure_locker -f backend/migration.sql
```

Or use the Python migration script:

```bash
python -m backend.migrations.migrate_to_multitenant
```

---

## 📡 API Endpoints

| Method | Endpoint             | Description                |
|:------ |:-------------------- |:-------------------------- |
| GET    | `/api/health`        | Health check               |
| GET    | `/api/routes`        | List all registered routes |
| POST   | `/api/auth/login`    | Admin login (JWT)          |
| *      | `/api/users/*`       | User / member management   |
| *      | `/api/lockers/*`     | Locker management          |
| *      | `/api/super-admin/*` | Super admin operations     |
| *      | `/api/password/*`    | Password management        |
| *      | `/api/sync/*`        | Data sync endpoints        |

> Access the full route list at runtime: **`GET /api/routes`**

---

## 🧰 Tech Stack

| Layer      | Technology                                |
|:---------- |:----------------------------------------- |
| Frontend   | React 18, React Router v6, Vite 5         |
| Backend    | Flask 3, Flask-SQLAlchemy, Flask-JWT-Extended |
| Database   | PostgreSQL 14+                            |
| Auth       | JWT (JSON Web Tokens)                     |
| Styling    | Vanilla CSS                               |

---

## 📝 License

This project is proprietary. All rights reserved.
