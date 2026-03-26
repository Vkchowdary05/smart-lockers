# Secure Locker System

A comprehensive full-stack management and security system for smart lockers. This project features guided face enrollment, real-time monitoring, and secure administrative controls, integrated with a Python-based computer vision pipeline.

---

## 🚀 Key Features

- **Guided Face Enrollment**: A 4-step interactive process (Center, Slight Left, Slight Right, Chin Up) with real-time pose validation.
- **Biometric Security**: High-accuracy face detection and 128D embedding generation using `face_recognition`.
- **Admin Dashboard**: Secure management interface for organizations, members, and locker status.
- **Real-time Monitoring**: Track locker usage and check-in/check-out logs instantly.
- **Dynamic Multi-Tenancy**: Support for multiple organizations with isolated data tables.

---

## 🛠 Tech Stack

### Frontend
- **Framework**: React 18 (Vite)
- **Routing**: React Router DOM v6
- **Styling**: Vanilla CSS (Custom UI Components)
- **API Client**: Fetch API

### Backend
- **Server**: Node.js (Express)
- **Authentication**: JWT (JSON Web Tokens)
- **Database**: PostgreSQL
- **File Handling**: Multer

### Python Service
- **Core**: Python 3.10+
- **Computer Vision**: `face_recognition`, `opencv-python`, `numpy`

---

## 📂 Project Structure

```text
secure-locker-main/
├── web-dashboard/
│   ├── backend-node/      # Express server & API routes
│   │   ├── routes/        # Auth, Members, Lockers, SuperAdmin
│   │   ├── services/      # Database & Business logic
│   │   └── scripts/       # Legacy face processing scripts
│   ├── frontend/          # React (Vite) application
│   │   ├── src/pages/     # Dashboard, Login, SuperAdmin
│   │   └── src/components/# AddUser (Enrollment), Navbar, etc.
│   └── python-services/   # Face Recognition module
│       └── face_processor.py
└── daemon/                # Media assets & hardware integration
```

---

## 📋 Prerequisites

Ensure you have the following installed:
- **Node.js**: v18.x or later
- **npm**: v9.x or later
- **Python**: v3.10+ (with `pip`)
- **PostgreSQL**: v14.x or later
- **C++ Compiler**: Required for `dlib` (dependency of `face_recognition`)

---

## ⚙️ Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/Vkchowdary05/smart-lockers.git
cd secure-locker-main
```

### 2. Backend Setup
```bash
cd web-dashboard/backend-node
npm install
```

### 3. Python Service Setup
```bash
# From the backend-node directory
pip install face_recognition opencv-python numpy
```

### 4. Frontend Setup
```bash
cd ../frontend
npm install
```

### 5. Environment Configuration
Create a `.env` file in `web-dashboard/backend-node/`:

```env
# Server
PORT=5001

# PostgreSQL
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=your_postgresql_user
POSTGRES_PASSWORD=your_postgresql_password
AUTH_POSTGRES_DB=locker_msl_auth

# Security
JWT_SECRET=your_secret_key
JWT_EXPIRES_IN=8h

# Initial Super Admin
SUPER_ADMIN_USERNAME=admin
SUPER_ADMIN_PASSWORD=your_password
SUPER_ADMIN_ORG_NAME=DefaultOrg

# Python
PYTHON_BIN=python
```

---

## 🏃 Running the Project

### Start Backend
In `web-dashboard/backend-node/`:
```bash
npm run dev
```

### Start Frontend
In `web-dashboard/frontend/`:
```bash
npm run dev
```

---

## 🔗 Integration Notes

- **API Connection**: The frontend communicates with the Node.js backend via the `API_BASE_URL` defined in `src/services/api.js`.
- **Python Subprocess**: The backend spawns a Python process to run `face_processor.py` for real-time face validation and embedding generation.
- **Data Flow**: `Frontend (Camera Capture) → Node.js (Base64) → Python (Validation/Encoding) → PostgreSQL (Persistence)`.

---

## ⚠️ Troubleshooting

- **Python Binary Not Found**: Update `PYTHON_BIN` in `.env` to the correct command (e.g., `python3` or an absolute path).
- **dlib Installation Error**: Ensure a C++ compiler (like Visual Studio Build Tools or `g++`) is installed and in your PATH.
- **Database Connection Refused**: Verify PostgreSQL is running and the credentials in `.env` match your setup.
- **Camera Access**: Ensure the browser has permission to access the webcam and no other app is using it.

---

## 🔮 Future Improvements

- [ ] Mobile App integration for locker access.
- [ ] Advanced Liveness Detection (Anti-spoofing).
- [ ] Integration with hardware locker controllers via MQTT.
- [ ] Cloud storage sync for face embeddings.
