import { pool } from "../config/database.js";
import { audit } from "./academyController.js";

function value(input) { return typeof input === "string" ? input.trim() : ""; }

export async function listProgrammes(req, res, next) {
    try {
        const [rows] = req.admin
            ? await pool.execute("SELECT id, name, description, duration, fee, status, created_at AS createdAt, updated_at AS updatedAt FROM programmes ORDER BY id")
            : await pool.execute("SELECT id, name, description, duration, fee, status FROM programmes WHERE status='Active' ORDER BY id");
        res.json({ success: true, data: rows });
    } catch (error) { next(error); }
}

export async function createProgramme(req, res, next) {
    const name = value(req.body?.name);
    const duration = value(req.body?.duration);
    const description = value(req.body?.description).slice(0, 5000);
    const fee = Number(req.body?.fee);
    if (!name || name.length > 160 || !duration || duration.length > 40 || !Number.isFinite(fee) || fee < 0) return res.status(400).json({ success: false, message: "Provide a name, duration and non-negative fee." });
    try {
        const [result] = await pool.execute("INSERT INTO programmes (name, description, duration, fee, status) VALUES (?, ?, ?, ?, ?)", [name, description || null, duration, fee, req.body.status === "Inactive" ? "Inactive" : "Active"]);
        const [rows] = await pool.execute("SELECT id, name, description, duration, fee, status FROM programmes WHERE id=?", [result.insertId]);
        await audit(req, "created", "programme", result.insertId);
        res.status(201).json({ success: true, programme: rows[0] });
    } catch (error) { if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "A programme with that name already exists." }); next(error); }
}

export async function updateProgramme(req, res, next) {
    const name = value(req.body?.name);
    const duration = value(req.body?.duration);
    const description = value(req.body?.description).slice(0, 5000);
    const fee = Number(req.body?.fee);
    const status = req.body?.status;
    if (!name || name.length > 160 || !duration || duration.length > 40 || !Number.isFinite(fee) || fee < 0 || !["Active", "Inactive"].includes(status)) return res.status(400).json({ success: false, message: "Provide valid programme details and status." });
    try {
        const [result] = await pool.execute("UPDATE programmes SET name=?, description=?, duration=?, fee=?, status=? WHERE id=?", [name, description || null, duration, fee, status, req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Programme not found." });
        await audit(req, "updated", "programme", req.params.id, { status });
        res.json({ success: true, message: "Programme updated." });
    } catch (error) { if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "A programme with that name already exists." }); next(error); }
}

export async function deleteProgramme(req, res, next) {
    try {
        const [result] = await pool.execute("UPDATE programmes SET status='Inactive' WHERE id=?", [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Programme not found." });
        await audit(req, "suspended", "programme", req.params.id);
        res.json({ success: true, message: "Programme deactivated." });
    } catch (error) { next(error); }
}
