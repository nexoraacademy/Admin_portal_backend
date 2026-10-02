import { pool } from "../config/database.js";

export async function listUsers(_req, res, next) {
    try {
        const [users] = await pool.execute(`SELECT id, name, email, role, status,
            failed_login_attempts AS failedLoginAttempts, locked_until AS lockedUntil,
            (locked_until > CURRENT_TIMESTAMP) AS isLocked, created_at AS createdAt
            FROM admin_users ORDER BY name`);
        res.json({ success: true, data: users });
    } catch (error) { next(error); }
}

export async function unlockUser(req, res, next) {
    try {
        const [result] = await pool.execute("UPDATE admin_users SET failed_login_attempts=0, locked_until=NULL WHERE id=?", [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Admin account not found." });
        res.json({ success: true, message: "Admin account unlocked." });
    } catch (error) { next(error); }
}
