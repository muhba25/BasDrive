# BasDrive

Penyimpanan berkas privat untuk web dan desktop (Windows/Linux), dengan berbagi tautan publik, akses per pengguna, password tautan, serta login lokal + LDAP/Active Directory.

## Arsitektur

```
[ Browser / Desktop window ]
            |
            v
     FastAPI (port 8000)
      |           |
   JWT+LDAP    File storage
      |           |
  SQLite/PG    backend/storage
```

- **Backend:** Python FastAPI (JWT, unggah, berbagi, LDAP)
- **Frontend web:** HTML/JS di `web/static` (siap pakai). Opsional React di `web/src` jika Node.js tersedia.
- **Desktop:** Python pywebview (Windows/Linux) atau Electron
- **Data:** SQLite (bisa diganti PostgreSQL via `DATABASE_URL`)

## Akun awal

| Username | Password     | Peran  |
|----------|--------------|--------|
| admin    | Admin@12345  | admin  |
| demo     | Demo@12345   | user   |

Ganti password admin sebelum dipakai di produksi (`ADMIN_PASSWORD` di `.env`).

## Menjalankan (pengembangan)

### 1. API + antarmuka web

Antarmuka utama ada di `web/static` dan dilayani langsung oleh FastAPI (tanpa wajib Node.js).

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --host 0.0.0.0 --reload --port 8000
```

- Di komputer ini: http://127.0.0.1:8000
- Dari HP/PC lain di jaringan yang sama: `http://IP-KOMPUTER:8000` (lihat bagian [Akses dari jaringan](#akses-dari-jaringan))
- Dokumentasi API: http://127.0.0.1:8000/docs

### 2. Desktop (Windows / Linux)

Aplikasi desktop Python (pywebview) memakai UI yang sama:

```bash
cd backend
.venv\Scripts\activate
python ..\desktop\basdrive.py
```

Atau Electron. Di PowerShell, jalankan **file .cmd** (bukan `.ps1`), karena execution policy Windows memblokir skrip:

```powershell
.\start-desktop.cmd
```

Atau dari folder `desktop`:

```powershell
npm.cmd start
```

Pastikan API sudah jalan di port 8000.

### 3. Installer Windows (.exe / .msi)

Bisa. Electron Builder menghasilkan:

- **Setup .exe** (NSIS) — installer dengan shortcut Start Menu/Desktop
- **Portable .exe** — satu file, tanpa instalasi
- **.msi** — butuh [WiX Toolset](https://wixtoolset.org/) di PC yang mem-build

Bangun installer (PowerShell execution policy tidak menghalangi `.cmd`):

```powershell
.\build-desktop.cmd
```

Hasilnya di `desktop\release\`:

- `BasDrive-1.0.0-win-x64.exe` — Setup
- `BasDrive-1.0.0-portable.exe` — portable

Untuk MSI:

```powershell
cd desktop
npm.cmd run pack:msi
```

Aplikasi terinstal tetap membuka server BasDrive di `http://127.0.0.1:8000`. Jalankan API dulu (`.\start-dev.cmd`) atau deploy API di server, lalu set `BASDRIVE_URL`.

## Docker

```bash
docker compose up --build
```

Buka http://127.0.0.1:8000 atau `http://IP-KOMPUTER:8000`

## Akses dari jaringan

Server harus listen di semua antarmuka (`--host 0.0.0.0`), bukan hanya localhost.

1. Jalankan: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
2. Cari IP LAN komputer ini, misalnya `192.168.1.10`
3. Dari perangkat lain di Wi‑Fi/LAN yang sama buka `http://192.168.1.10:8000`
4. Izinkan port **8000** di Windows Firewall jika diminta

Akses dari internet (bukan hanya LAN) membutuhkan port forwarding di router ke PC ini, plus HTTPS di reverse proxy. Jangan buka ke internet tanpa ganti `SECRET_KEY` dan password admin.

## LDAP / Active Directory

Set di `backend/.env`:

```
LDAP_ENABLED=true
LDAP_SERVER=ldap://dc.company.local
LDAP_PORT=389
LDAP_BASE_DN=DC=company,DC=local
LDAP_DOMAIN=company.local
LDAP_BIND_DN=CN=basdrive,OU=Service Accounts,DC=company,DC=local
LDAP_BIND_PASSWORD=******
```

- Login bisa memakai `sAMAccountName` atau UPN (`user@company.local`)
- Pengguna AD dibuat otomatis di BasDrive saat login pertama
- Uji koneksi dari menu **Admin**
- Untuk LDAPS: `LDAP_USE_SSL=true` dan `LDAP_PORT=636`

Filter default kompatibel dengan Active Directory (termasuk lingkungan Exchange) dan OpenLDAP (`uid`).

## Berbagi

- **Pengguna tertentu:** cari username/email, izin lihat / unduh / edit
- **Tautan publik:** siapa pun yang punya URL
- **Password tautan:** opsional, berlaku untuk tautan publik
- Halaman publik: `/s/{token}`

## Produksi

1. Ganti `SECRET_KEY` dan password admin
2. Gunakan PostgreSQL: `DATABASE_URL=postgresql+psycopg://user:pass@host/basdrive`
3. Letakkan storage di volume terpisah
4. Nonaktifkan daftar publik jika hanya LDAP: `ALLOW_REGISTER=false`
5. Pasang HTTPS di reverse proxy (nginx/Caddy)
