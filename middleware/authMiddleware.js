import jwt from "jsonwebtoken";
import { pool } from "../config/database.js";

export const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: 8 * 60 * 60 * 1000,
};

export async function authenticate(req, res, next) {
    const token = req.cookies?.nexora_admin;
    if (!token) return res.status(401).json({ success: false, message: "Authentication required." });
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await pool.execute("SELECT id, name, email, role, status, (locked_until > CURRENT_TIMESTAMP) AS isLocked FROM admin_users WHERE id = ? LIMIT 1", [payload.sub]);
        if (!rows.length || rows[0].status !== "Active" || rows[0].isLocked) return res.status(401).json({ success: false, message: "Your session is no longer active." });
        req.admin = rows[0];
        next();
    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") return res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
        next(error);
    }
}

export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.admin || !roles.includes(req.admin.role)) return res.status(403).json({ success: false, message: "You do not have permission to perform this action." });
        next();
    };
}
