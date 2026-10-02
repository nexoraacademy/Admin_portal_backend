import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { audit } from "./academyController.js";

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export async function listCertificates(_req, res, next) {
    try {
        const [rows] = await pool.execute(`SELECT c.id, c.certificate_number AS certificateNumber,
            CONCAT(a.first_name, ' ', a.last_name) AS studentName, p.name AS programmeName,
            c.completion_date AS completionDate, c.issue_date AS issueDate, c.status
            FROM certificates c JOIN applicants a ON a.id=c.applicant_id
            JOIN programmes p ON p.id=c.programme_id ORDER BY c.created_at DESC LIMIT 500`);
        res.json({ success: true, data: rows });
    } catch (error) { next(error); }
}

export async function verifyCertificate(req, res, next) {
    try {
        const number = String(req.params.certificateNumber || "").trim().toUpperCase();
        const [rows] = await pool.execute(`SELECT c.certificate_number AS certificateNumber,
            CONCAT(a.first_name, ' ', a.last_name) AS studentName, p.name AS programmeName,
            c.completion_date AS completionDate, c.issue_date AS issueDate, c.status
            FROM certificates c JOIN applicants a ON a.id=c.applicant_id
            JOIN programmes p ON p.id=c.programme_id WHERE c.certificate_number=? LIMIT 1`, [number]);
        if (!rows.length) return res.status(404).json({ success: true, valid: false, message: "No certificate was found with that number." });
        const certificate = rows[0];
        res.json({ success: true, valid: certificate.status === "Valid", certificate });
    } catch (error) { next(error); }
}

export async function issueCertificate(req, res, next) {
    const applicationId = Number(req.body?.applicationId);
    const completionDate = String(req.body?.completionDate || "");
    if (!Number.isInteger(applicationId) || !validDate(completionDate)) return res.status(400).json({ success: false, message: "Provide a valid accepted application and completion date (YYYY-MM-DD)." });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [applications] = await connection.execute(`SELECT ap.id, ap.applicant_id AS applicantId, ap.programme_id AS programmeId, ap.status, e.id AS enrolmentId, e.completion_status AS completionStatus FROM applications ap LEFT JOIN enrolments e ON e.application_id=ap.id WHERE ap.id=? FOR UPDATE`, [applicationId]);
        if (!applications.length) { await connection.rollback(); return res.status(404).json({ success: false, message: "Application not found." }); }
        if (applications[0].status !== "Accepted" || applications[0].completionStatus !== "Passed") { await connection.rollback(); return res.status(400).json({ success: false, message: "A certificate requires an enrolled learner who has passed programme completion." }); }
        const [existing] = await connection.execute("SELECT id FROM certificates WHERE applicant_id=? AND programme_id=? AND status='Valid' LIMIT 1", [applications[0].applicantId, applications[0].programmeId]);
        if (existing.length) { await connection.rollback(); return res.status(409).json({ success: false, message: "A valid certificate already exists for this learner and programme." }); }
        const [result] = await connection.execute("INSERT INTO certificates (certificate_number, applicant_id, programme_id, enrolment_id, completion_date, issue_date) VALUES (?, ?, ?, ?, ?, CURDATE())", [`CREATING-${randomUUID()}`, applications[0].applicantId, applications[0].programmeId, applications[0].enrolmentId, completionDate]);
        const year = new Date().getFullYear();
        const certificateNumber = `NEX-CERT-${year}-${String(result.insertId).padStart(5, "0")}`;
        await connection.execute("UPDATE certificates SET certificate_number=? WHERE id=?", [certificateNumber, result.insertId]);
        await connection.commit();
        await audit(req, "issued", "certificate", result.insertId, { certificateNumber });
        res.status(201).json({ success: true, certificateNumber });
    } catch (error) { await connection.rollback(); next(error); }
    finally { connection.release(); }
}

export async function revokeCertificate(req, res, next) {
    try {
        const [result] = await pool.execute("UPDATE certificates SET status='Revoked' WHERE id=? AND status='Valid'", [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Valid certificate not found." });
        await audit(req, "revoked", "certificate", req.params.id);
        res.json({ success: true, message: "Certificate revoked." });
    } catch (error) { next(error); }
}
