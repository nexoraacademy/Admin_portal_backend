# Nexora Academy API

Express API and MySQL data layer for the Nexora Academy portal. The API uses parameterized MySQL queries, HTTP-only JWT cookies, role checks and private identity-document uploads.

## First run on Windows

1. Start MySQL from XAMPP and confirm the MySQL service is listening on port 3306.
2. In this `backend` directory, install the dependencies:

   ```powershell
   npm install
   ```

3. Copy `.env.example` to `.env`. PowerShell command:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Set `DB_USER` / `DB_PASSWORD`, a unique `JWT_SECRET`, and an `ADMIN_PASSWORD` of at least 8 characters in `.env`. The configured MySQL user needs permission to create the `nexora_academy` database and tables.
5. Start the API:

   ```powershell
   npm run dev
   ```

The first start creates the database, tables, seven initial programmes, and the Super Admin account. The admin account is seeded only when its configured email is not already present. Changing `ADMIN_PASSWORD` later will not reset an existing account password.

Check `http://localhost:5000/api/health` for the API health response. The frontend is expected at `http://localhost:5173` by default.

## Main API routes

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/dashboard`
- `GET /api/applications`, `GET /api/applications/:id`, `PATCH /api/applications/:id`
- `POST /api/applications` (public; optional `identityDocument` PDF/JPEG/PNG, up to 5 MB)
- `GET /api/students`
- `GET /api/programmes`, `POST /api/programmes`, `PUT /api/programmes/:id`, `DELETE /api/programmes/:id`
- `GET /api/certificates`, `POST /api/certificates`, `PATCH /api/certificates/:id/revoke`
- `GET /api/certificates/verify/:certificateNumber` (public and returns no private applicant details)
- `GET /api/users` (Super Admin only)
- `PATCH /api/users/:id/unlock` (Super Admin only; clears failed-password lockout)
- `GET /api/lecturers`, `POST /api/lecturers`, `PATCH /api/lecturers/:id`, `DELETE /api/lecturers/:id`
- `GET /api/payments`, `POST /api/payments`, `PATCH /api/payments/:id` (admin payment ledger; online gateway checkout/webhooks need provider configuration)

Uploaded identity documents stay in `uploads/` and are never served as public static files. They can only be retrieved by an authenticated admin using the protected application identity-document route.
