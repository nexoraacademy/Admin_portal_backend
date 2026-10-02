import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/database.js";
import { cookieOptions } from "../middleware/authMiddleware.js";

export async function login(req, res, next) {
    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        if (!email || !password) return res.status(400).json({ success: false, message: "Email and password are required." });
        const [rows] = await pool.execute("SELECT id, name, email, password_hash, role, status, failed_login_attempts AS failedLoginAttempts, locked_until AS lockedUntil, (locked_until > CURRENT_TIMESTAMP) AS isLocked FROM admin_users WHERE email = ? LIMIT 1", [email]);
        const admin = rows[0];
        if (admin?.isLocked) return res.status(423).json({ success: false, message: "This account is temporarily locked after too many incorrect password attempts. Ask a Super Admin to unlock it, or wait 15 minutes." });
        if (admin && admin.status !== "Active") return res.status(403).json({ success: false, message: "This account is inactive. Contact a Super Admin." });
        const valid = admin && await bcrypt.compare(password, admin.password_hash);
        if (!valid) {
            if (admin) {
                await pool.execute(`UPDATE admin_users SET locked_until=CASE WHEN failed_login_attempts+1 >= 5 THEN DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE) ELSE locked_until END,
                    failed_login_attempts=failed_login_attempts+1
                    WHERE id=?`, [admin.id]);
                const [updated] = await pool.execute("SELECT failed_login_attempts AS failedLoginAttempts, (locked_until > CURRENT_TIMESTAMP) AS isLocked FROM admin_users WHERE id=?", [admin.id]);
                if (updated[0]?.isLocked) return res.status(423).json({ success: false, message: "This account is locked for 15 minutes after 5 incorrect password attempts. Ask a Super Admin to unlock it." });
                return res.status(401).json({ success: false, message: "Email or password is incorrect.", attemptsRemaining: Math.max(0, 5 - updated[0].failedLoginAttempts) });
            }
            return res.status(401).json({ success: false, message: "Email or password is incorrect." });
        }
        await pool.execute("UPDATE admin_users SET failed_login_attempts=0, locked_until=NULL WHERE id=?", [admin.id]);
        const token = jwt.sign({ sub: admin.id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: "8h", issuer: "nexora-academy" });
        res.cookie("nexora_admin", token, cookieOptions);
        res.json({ success: true, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
    } catch (error) { next(error); }
}

export function logout(_req, res) {
    res.clearCookie("nexora_admin", { ...cookieOptions, maxAge: undefined });
    res.json({ success: true, message: "Signed out." });
}

export function me(req, res) {
    res.json({ success: true, admin: req.admin });
}
