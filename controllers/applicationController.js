import { pool } from "../config/database.js";
import { randomUUID } from "node:crypto";
import { audit } from "./academyController.js";
import { sendApplicationStatusEmail } from "../services/emailService.js";

const statuses = ["Pending", "Under Review", "Accepted", "Rejected", "Waitlisted"];
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function clean(value, limit = 2000) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export async function submitApplication(req, res, next) {
    const body = req.body || {};
    const firstName = clean(body.firstName, 100);
    const lastName = clean(body.lastName, 100);
    const idNumber = clean(body.idNumber || body.idPassportNumber, 30);
    const phone = clean(body.phone, 40);
    const email = clean(body.email, 190).toLowerCase();
    const programmeId = Number(body.programmeId || body.programme);
    const dob = clean(body.dateOfBirth, 10) || null;
    if (!firstName || !lastName || !idNumber || !phone || !email || !Number.isInteger(programmeId)) {
        return res.status(400).json({ success: false, message: "First name, last name, ID or passport number, phone, email and a valid programme are required." });
    }
    if (dob && !validDate(dob)) {
        return res.status(400).json({ success: false, message: "Date of birth must use YYYY-MM-DD format." });
    }
    if (req.file) {
        const bytes = req.file.buffer;
        const isPdf = bytes.subarray(0, 5).toString() === "%PDF-";
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        if (!isPdf && !isJpeg && !isPng) return res.status(400).json({ success: false, message: "The identity document file does not match an accepted PDF, JPEG or PNG format." });
    }
    const preferredStartDate = clean(body.preferredStartDate, 10) || null;
    if (preferredStartDate && !validDate(preferredStartDate)) {
        return res.status(400).json({ success: false, message: "Preferred start date must use YYYY-MM-DD format." });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [programmes] = await connection.execute("SELECT id FROM programmes WHERE id = ? AND status = 'Active' LIMIT 1", [programmeId]);
        if (!programmes.length) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: "Please select an active programme." });
        }
        const [existing] = await connection.execute("SELECT id FROM applicants WHERE id_number = ? LIMIT 1", [idNumber]);
        let applicantId;
        if (existing.length) {
            applicantId = existing[0].id;
            await connection.execute(`UPDATE applicants SET first_name=?, last_name=?, date_of_birth=?, gender=?, phone=?, email=?, address=?, qualification=?, institution=?, experience=?, id_document=COALESCE(?, id_document), id_document_data=COALESCE(?, id_document_data), id_document_mime=COALESCE(?, id_document_mime) WHERE id=?`, [firstName, lastName, dob, clean(body.gender, 40) || null, phone, email, clean(body.address) || null, clean(body.qualification, 180) || null, clean(body.institution, 180) || null, clean(body.experience) || null, req.file ? "stored-in-database" : null, req.file?.buffer || null, req.file?.mimetype || null, applicantId]);
        } else {
            const [result] = await connection.execute(`INSERT INTO applicants (first_name,last_name,id_number,date_of_birth,gender,phone,email,address,qualification,institution,experience,id_document,id_document_data,id_document_mime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [firstName, lastName, idNumber, dob, clean(body.gender, 40) || null, phone, email, clean(body.address) || null, clean(body.qualification, 180) || null, clean(body.institution, 180) || null, clean(body.experience) || null, req.file ? "stored-in-database" : null, req.file?.buffer || null, req.file?.mimetype || null]);
            applicantId = result.insertId;
        }
        const [application] = await connection.execute("INSERT INTO applications (applicant_id, programme_id, preferred_start_date, motivation) VALUES (?, ?, ?, ?)", [applicantId, programmeId, preferredStartDate, clean(body.motivation) || null]);
        await connection.execute("INSERT INTO application_history (application_id, admin_user_id, old_status, new_status, comment) VALUES (?, NULL, NULL, 'Pending', 'Application submitted')", [application.insertId]);
        await connection.commit();
        res.status(201).json({ success: true, message: "Your application has been received.", applicationId: application.insertId });
    } catch (error) {
        await connection.rollback();
        if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "An application could not be saved because this ID or passport number is already in use." });
        next(error);
    } finally { connection.release(); }
}

export async function checkApplicationStatus(req, res, next) {
    const idNumber = clean(req.body?.idNumber, 30).replace(/\s/g, "");
    if (!idNumber || idNumber.length < 6) return res.status(400).json({ success: false, message: "Enter a valid ID or passport number." });
    try {
        const [rows] = await pool.execute(
            `SELECT ap.id, ap.status, p.name AS programmeName, p.fee AS programmeFee,
                COALESCE((SELECT SUM(pay.amount) FROM payments pay LEFT JOIN enrolments pe ON pe.id=pay.enrolment_id
                    WHERE pay.status='Paid' AND (pay.application_id=ap.id OR pe.application_id=ap.id)),0) AS amountPaid,
                EXISTS(SELECT 1 FROM enrolments e JOIN students s ON s.id=e.student_id WHERE e.application_id=ap.id AND e.status='Active' AND s.status='Active') AS isFullTime
             FROM applicants a JOIN applications ap ON ap.applicant_id=a.id JOIN programmes p ON p.id=ap.programme_id
             WHERE a.id_number=? ORDER BY ap.created_at DESC LIMIT 1`, [idNumber]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: "No application was found for those details." });
        const application = rows[0];
        const minimumPayment = Math.ceil(Number(application.programmeFee) * 25 - 1e-8) / 100;
        const amountPaid = Number(application.amountPaid);
        res.json({ success: true, application: { status: application.status, programmeName: application.programmeName,
            minimumPayment, amountPaid, amountRemaining: Math.max(0, Math.round((minimumPayment - amountPaid) * 100) / 100),
            isFullTime: Boolean(application.isFullTime), demoPaymentEnabled: process.env.NODE_ENV === "development" } });
    } catch (error) { next(error); }
}

export async function simulateDemoPayment(req, res, next) {
    if (process.env.NODE_ENV !== "development") return res.status(404).json({ success: false, message: "Not found." });
    const idNumber = clean(req.body?.idNumber, 30).replace(/\s/g, "");
    if (!idNumber || idNumber.length < 6) return res.status(400).json({ success: false, message: "Enter a valid ID or passport number." });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT ap.id AS applicationId, ap.applicant_id AS applicantId, ap.programme_id AS programmeId,
                ap.preferred_start_date AS startDate, ap.status, p.fee AS programmeFee
             FROM applicants a JOIN applications ap ON ap.applicant_id=a.id JOIN programmes p ON p.id=ap.programme_id
             WHERE a.id_number=? ORDER BY ap.created_at DESC LIMIT 1 FOR UPDATE`, [idNumber]
        );
        if (!rows.length) { await connection.rollback(); return res.status(404).json({ success: false, message: "No application was found for those details." }); }
        const application = rows[0];
        if (application.status !== "Accepted") { await connection.rollback(); return res.status(409).json({ success: false, message: "Only accepted applications can make the enrolment deposit." }); }
        const minimumPayment = Math.ceil(Number(application.programmeFee) * 25 - 1e-8) / 100;
        const [studentRows] = await connection.execute("SELECT id,status FROM students WHERE applicant_id=? LIMIT 1 FOR UPDATE", [application.applicantId]);
        if (studentRows[0]?.status === "Suspended" || studentRows[0]?.status === "Withdrawn") { await connection.rollback(); return res.status(409).json({ success: false, message: "Please contact the Academy about this student account." }); }
        const [existingEnrolments] = await connection.execute("SELECT id,status FROM enrolments WHERE application_id=? LIMIT 1 FOR UPDATE", [application.applicationId]);
        const existingEnrolment = existingEnrolments[0] || null;
        const [paidRows] = await connection.execute(
            "SELECT COALESCE(SUM(pay.amount),0) AS amountPaid FROM payments pay LEFT JOIN enrolments e ON e.id=pay.enrolment_id WHERE pay.status='Paid' AND (pay.application_id=? OR e.application_id=?)",
            [application.applicationId, application.applicationId]
        );
        const alreadyPaid = Number(paidRows[0].amountPaid);
        const amountDue = Math.max(0, Math.round((minimumPayment - alreadyPaid) * 100) / 100);
        const [studentResult] = await connection.execute(
            "INSERT INTO students (applicant_id,status) VALUES (?,'Active') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
            [application.applicantId]
        );
        const studentId = studentRows[0]?.id || studentResult.insertId;
        let enrolmentId = existingEnrolment?.id;
        if (!enrolmentId) {
            const [enrolmentResult] = await connection.execute(
                "INSERT INTO enrolments (student_id,application_id,programme_id,cohort_id,enrolled_at,start_date,status) VALUES (?,?,?,NULL,CURRENT_DATE,?,'Active')",
                [studentId, application.applicationId, application.programmeId, application.startDate]
            );
            enrolmentId = enrolmentResult.insertId;
        }
        if (amountDue > 0) {
            await connection.execute(
                "INSERT INTO payments (application_id,enrolment_id,amount,status,method,reference,paid_at,notes,recorded_by) VALUES (?, ?, ?, 'Paid', 'Demo Payment', ?, CURRENT_TIMESTAMP, 'Simulated 25% enrolment deposit for development testing.', NULL)",
                [application.applicationId, enrolmentId, amountDue.toFixed(2), `DEMO-${randomUUID()}`]
            );
        }
        await connection.commit();
        res.json({ success: true, message: "Demo deposit recorded. The student is now active and enrolled.",
            amountPaid: Math.round((alreadyPaid + amountDue) * 100) / 100, minimumPayment, enrolmentId, isFullTime: true });
    } catch (error) {
        await connection.rollback();
        if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ success: false, message: "This application already has an enrolment. Refresh the status and try again." });
        next(error);
    } finally { connection.release(); }
}

export async function listApplications(req, res, next) {
    try {
        const where = [];
        const values = [];
        const status = clean(req.query.status, 30);
        const search = clean(req.query.search, 120);
        if (status && statuses.includes(status)) { where.push("ap.status = ?"); values.push(status); }
        if (search) {
            where.push("(a.first_name LIKE ? OR a.last_name LIKE ? OR a.email LIKE ? OR p.name LIKE ?)");
            values.push(...Array(4).fill(`%${search}%`));
        }
        const sql = `SELECT ap.id, ap.programme_id AS programmeId, CONCAT(a.first_name, ' ', a.last_name) AS applicantName, a.email, a.phone, p.name AS programmeName, p.fee AS programmeFee, ap.status, ap.created_at AS createdAt, ap.updated_at AS updatedAt, EXISTS(SELECT 1 FROM enrolments e WHERE e.application_id=ap.id) AS isEnrolled FROM applications ap JOIN applicants a ON a.id=ap.applicant_id JOIN programmes p ON p.id=ap.programme_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ap.created_at DESC LIMIT 500`;
        const [rows] = await pool.execute(sql, values);
        res.json({ success: true, data: rows });
    } catch (error) { next(error); }
}

export async function getApplication(req, res, next) {
    try {
        const [rows] = await pool.execute(`SELECT ap.id, ap.status, ap.admin_comment AS adminComment, ap.status_email_sent_at AS statusEmailSentAt, ap.status_email_error AS statusEmailError, ap.preferred_start_date AS preferredStartDate, ap.motivation, ap.created_at AS createdAt, a.id AS applicantId, a.first_name AS firstName, a.last_name AS lastName, a.id_number AS idNumber, a.date_of_birth AS dateOfBirth, a.gender, a.phone, a.email, a.address, a.qualification, a.institution, a.experience, a.id_document AS idDocument, p.id AS programmeId, p.name AS programmeName FROM applications ap JOIN applicants a ON a.id=ap.applicant_id JOIN programmes p ON p.id=ap.programme_id WHERE ap.id=? LIMIT 1`, [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Application not found." });
        const [history] = await pool.execute("SELECT h.id, h.old_status AS oldStatus, h.new_status AS newStatus, h.comment, h.created_at AS createdAt, u.name AS adminName FROM application_history h LEFT JOIN admin_users u ON u.id=h.admin_user_id WHERE h.application_id=? ORDER BY h.created_at DESC", [req.params.id]);
        res.json({ success: true, application: rows[0], history });
    } catch (error) { next(error); }
}

export async function updateApplication(req, res, next) {
    const status = clean(req.body?.status, 30);
    const statusNote = clean(req.body?.comment);
    const emailNote = clean(req.body?.emailNote);
    if (!statuses.includes(status)) return res.status(400).json({ success: false, message: "Choose a valid application status." });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute("SELECT status FROM applications WHERE id=? FOR UPDATE", [req.params.id]);
        if (!rows.length) { await connection.rollback(); return res.status(404).json({ success: false, message: "Application not found." }); }
        const oldStatus = rows[0].status;
        const historyNote = [statusNote, emailNote ? "Email note: " + emailNote : ""].filter(Boolean).join("\n\n").slice(0, 4000);
        await connection.execute("UPDATE applications SET status=?, admin_comment=IF(?='', admin_comment, ?), status_email_error=IF(? IN ('Accepted','Rejected') AND ?<>?, status_email_error, NULL) WHERE id=?", [status, historyNote, historyNote, status, oldStatus, status, req.params.id]);
        if (oldStatus !== status || historyNote) await connection.execute("INSERT INTO application_history (application_id,admin_user_id,old_status,new_status,comment) VALUES (?,?,?,?,?)", [req.params.id, req.admin.id, oldStatus, status, historyNote || null]);
        await connection.commit();

        let emailSent = null;
        let emailMessage = null;
        if (oldStatus !== status && ["Accepted", "Rejected"].includes(status)) {
            try {
                const [applicationRows] = await pool.execute("SELECT a.first_name AS firstName,a.last_name AS lastName,a.email,p.name AS programmeName FROM applications ap JOIN applicants a ON a.id=ap.applicant_id JOIN programmes p ON p.id=ap.programme_id WHERE ap.id=? LIMIT 1", [req.params.id]);
                if (!applicationRows.length) throw new Error("Application recipient could not be loaded.");
                const recipient = applicationRows[0];
                await sendApplicationStatusEmail({ to: recipient.email, applicantName: recipient.firstName + " " + recipient.lastName, programmeName: recipient.programmeName, status, note: emailNote });
                await pool.execute("UPDATE applications SET status_email_sent_at=CURRENT_TIMESTAMP,status_email_error=NULL WHERE id=?", [req.params.id]);
                emailSent = true;
                await audit(req, "status_email_sent", "application", req.params.id, { status });
            } catch (mailError) {
                await pool.execute("UPDATE applications SET status_email_error=? WHERE id=?", [String(mailError.message || "Email delivery failed.").slice(0, 500), req.params.id]);
                emailSent = false;
                emailMessage = "The application status was saved, but the email could not be sent. Check SMTP settings, then retry the email.";
            }
        }
        await audit(req, status === "Accepted" ? "approved" : status === "Rejected" ? "rejected" : "updated", "application", req.params.id, { oldStatus, newStatus: status, emailSent });
        res.json({ success: true, message: "Application updated.", status, emailSent, emailMessage });
    } catch (error) { await connection.rollback(); next(error); }
    finally { connection.release(); }
}

export async function resendApplicationEmail(req, res, next) {
    const emailNote = clean(req.body?.emailNote);
    try {
        const [rows] = await pool.execute("SELECT ap.status,a.first_name AS firstName,a.last_name AS lastName,a.email,p.name AS programmeName FROM applications ap JOIN applicants a ON a.id=ap.applicant_id JOIN programmes p ON p.id=ap.programme_id WHERE ap.id=? LIMIT 1", [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: "Application not found." });
        const application = rows[0];
        if (!["Accepted", "Rejected"].includes(application.status)) return res.status(409).json({ success: false, message: "Email is available only for an accepted or rejected application." });
        await sendApplicationStatusEmail({ to: application.email, applicantName: application.firstName + " " + application.lastName, programmeName: application.programmeName, status: application.status, note: emailNote });
        await pool.execute("UPDATE applications SET status_email_sent_at=CURRENT_TIMESTAMP,status_email_error=NULL WHERE id=?", [req.params.id]);
        await audit(req, "status_email_resent", "application", req.params.id, { status: application.status });
        res.json({ success: true, emailSent: true });
    } catch (error) {
        if (error.message?.includes("SMTP")) return res.status(503).json({ success: false, message: "Email is not configured. Set SMTP_HOST, SMTP_FROM_EMAIL, SMTP_USER and SMTP_PASSWORD in backend/.env." });
        next(error);
    }
}

export async function getIdentityDocument(req, res, next) {
    try {
        const [rows] = await pool.execute("SELECT id_document, id_document_data, id_document_mime FROM applicants WHERE id=? LIMIT 1", [req.params.applicantId]);
        if (!rows.length || !rows[0].id_document) return res.status(404).json({ success: false, message: "Identity document not found." });
        if (rows[0].id_document_data) return res.type(rows[0].id_document_mime || "application/octet-stream").attachment("identity-document").send(rows[0].id_document_data);
        const path = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const root = path.dirname(fileURLToPath(import.meta.url));
        res.sendFile(path.join(root, "..", "uploads", rows[0].id_document), (error) => { if (error && !res.headersSent) next(error); });
    } catch (error) { next(error); }
}
