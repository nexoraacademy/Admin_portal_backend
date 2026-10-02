import { pool } from "../config/database.js";

const trim = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function listLecturers(_req, res, next) {
    try {
        const [lecturers] = await pool.execute("SELECT id, name, email, phone, expertise, status, created_at AS createdAt FROM lecturers ORDER BY name");
        res.json({ success: true, data: lecturers });
    } catch (error) { next(error); }
}

export async function createLecturer(req, res, next) {
    const name = trim(req.body?.name, 150);
    const email = trim(req.body?.email, 190).toLowerCase();
    const phone = trim(req.body?.phone, 40);
    const expertise = trim(req.body?.expertise, 255);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a lecturer name and valid email address." });
    try {
        const [result] = await pool.execute("INSERT INTO lecturers (name, email, phone, expertise) VALUES (?, ?, ?, ?)", [name, email, phone || null, expertise || null]);
        res.status(201).json({ success: true, lecturer: { id: result.insertId, name, email, phone, expertise, status: "Active" } });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "A lecturer with that email already exists." });
        next(error);
    }
}

export async function updateLecturer(req, res, next) {
    const status = req.body?.status;
    if (!["Active", "Inactive"].includes(status)) return res.status(400).json({ success: false, message: "Choose Active or Inactive status." });
    try {
        const [result] = await pool.execute("UPDATE lecturers SET status=? WHERE id=?", [status, req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Lecturer not found." });
        res.json({ success: true, message: "Lecturer status updated." });
    } catch (error) { next(error); }
}

export async function deleteLecturer(req, res, next) {
    try {
        const [result] = await pool.execute("DELETE FROM lecturers WHERE id=?", [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Lecturer not found." });
        res.json({ success: true, message: "Lecturer deleted." });
    } catch (error) { next(error); }
}
