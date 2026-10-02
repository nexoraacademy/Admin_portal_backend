import { pool } from "../config/database.js";
import { audit } from "./academyController.js";

const statuses = ["Paid", "Pending", "Failed", "Refunded"];
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export async function listPayments(req, res, next) {
    try {
        const where = [];
        const values = [];
        const status = String(req.query.status || "").trim();
        const search = String(req.query.search || "").trim().slice(0, 120);
        if (statuses.includes(status)) { where.push("pay.status=?"); values.push(status); }
        if (search) {
            where.push("(CONCAT(a.first_name,' ',a.last_name) LIKE ? OR a.email LIKE ? OR p.name LIKE ? OR pay.reference LIKE ?)");
            values.push(...Array(4).fill(`%${search}%`));
        }
        const [rows] = await pool.execute(`SELECT pay.id, pay.application_id AS applicationId, pay.enrolment_id AS enrolmentId,
            CONCAT(a.first_name,' ',a.last_name) AS learnerName, a.email AS learnerEmail,
            p.name AS programmeName, pay.amount, pay.status, pay.method, pay.reference,
            pay.paid_at AS paidAt, pay.notes, u.name AS recordedBy, pay.created_at AS createdAt
            FROM payments pay LEFT JOIN applications ap ON ap.id=pay.application_id
            LEFT JOIN enrolments e ON e.id=pay.enrolment_id LEFT JOIN students st ON st.id=e.student_id
            LEFT JOIN applicants a ON a.id=COALESCE(st.applicant_id,ap.applicant_id)
            LEFT JOIN programmes p ON p.id=COALESCE(e.programme_id,ap.programme_id)
            LEFT JOIN admin_users u ON u.id=pay.recorded_by ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
            ORDER BY pay.created_at DESC LIMIT 500`, values);
        res.json({ success: true, data: rows });
    } catch (error) { next(error); }
}

export async function recordPayment(req, res, next) {
    const applicationId = req.body?.applicationId ? Number(req.body.applicationId) : null;
    const enrolmentId = req.body?.enrolmentId ? Number(req.body.enrolmentId) : null;
    const amount = Number(req.body?.amount);
    const status = req.body?.status || "Paid";
    const method = typeof req.body?.method === "string" ? req.body.method.trim().slice(0, 60) : "";
    const reference = typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 160) : "";
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 1000) : "";
    const paidDate = typeof req.body?.paidDate === "string" ? req.body.paidDate.trim() : "";
    if ((!Number.isSafeInteger(applicationId) && !Number.isSafeInteger(enrolmentId)) || !Number.isFinite(amount) || amount <= 0 || amount > 10000000 || !method || !statuses.includes(status) || (paidDate && !validDate(paidDate))) {
        return res.status(400).json({ success: false, message: "Provide a valid enrolment, positive amount, payment method, status and optional payment date." });
    }
    try {
        if (enrolmentId) {
            const [enrolments] = await pool.execute("SELECT id FROM enrolments WHERE id=? LIMIT 1", [enrolmentId]);
            if (!enrolments.length) return res.status(404).json({ success: false, message: "Enrolment not found." });
        } else {
            const [applications] = await pool.execute("SELECT id FROM applications WHERE id=? LIMIT 1", [applicationId]);
            if (!applications.length) return res.status(404).json({ success: false, message: "Application not found." });
        }
        const [result] = await pool.execute(`INSERT INTO payments (application_id,enrolment_id, amount, status, method, reference, paid_at, notes, recorded_by)
            VALUES (?, ?, ?, ?, ?, ?, IF(?='Paid', COALESCE(?, CURRENT_TIMESTAMP), NULL), ?, ?)`,
        [enrolmentId ? null : applicationId, enrolmentId, amount.toFixed(2), status, method, reference || null, status, paidDate ? `${paidDate} 00:00:00` : null, notes || null, req.admin.id]);
        await audit(req, "recorded", "payment", result.insertId, { amount: amount.toFixed(2), status });
        res.status(201).json({ success: true, paymentId: result.insertId, message: "Payment record added." });
    } catch (error) { next(error); }
}

export async function updatePaymentStatus(req, res, next) {
    const status = req.body?.status;
    const paidDate = typeof req.body?.paidDate === "string" ? req.body.paidDate.trim() : "";
    if (!statuses.includes(status) || (paidDate && !validDate(paidDate))) return res.status(400).json({ success: false, message: "Choose a valid payment status and date." });
    try {
        const [result] = await pool.execute(`UPDATE payments SET status=?, paid_at=CASE WHEN ?='Paid' THEN COALESCE(?, paid_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE id=?`, [status, status, paidDate ? `${paidDate} 00:00:00` : null, req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Payment record not found." });
        await audit(req, "updated", "payment", req.params.id, { status });
        res.json({ success: true, message: "Payment status updated." });
    } catch (error) { next(error); }
}
