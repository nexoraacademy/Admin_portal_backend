import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { audit } from "./academyController.js";

export async function listDocuments(_req, res, next) {
    try {
        const [rows] = await pool.execute(`SELECT d.id,d.student_id AS studentId,d.document_type AS documentType,
            d.original_name AS originalName,d.mime_type AS mimeType,d.size_bytes AS sizeBytes,
            d.created_at AS uploadedAt,CONCAT(a.first_name,' ',a.last_name) AS studentName,a.email
            FROM student_documents d JOIN students s ON s.id=d.student_id
            JOIN applicants a ON a.id=s.applicant_id ORDER BY d.created_at DESC`);
        res.json({ success: true, data: rows });
    } catch (error) { next(error); }
}

export async function uploadDocument(req, res, next) {
    const studentId = Number(req.body?.studentId);
    const documentType = String(req.body?.documentType || "").trim().slice(0, 80);
    const file = req.file;
    if (!Number.isSafeInteger(studentId) || !documentType) return res.status(400).json({ success: false, message: "Student and document type are required." });
    if (!file) return res.status(400).json({ success: false, message: "Select a PDF, JPEG or PNG document up to 5 MB." });
    const bytes = file.buffer;
    const valid = (file.mimetype === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-")
        || (file.mimetype === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        || (file.mimetype === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    if (!valid) return res.status(400).json({ success: false, message: "The file content does not match an accepted PDF, JPEG or PNG type." });
    try {
        const [students] = await pool.execute("SELECT id FROM students WHERE id=?", [studentId]);
        if (!students.length) return res.status(404).json({ success: false, message: "Student not found." });
        const [result] = await pool.execute(`INSERT INTO student_documents
            (student_id,document_type,original_name,stored_name,mime_type,size_bytes,file_content,uploaded_by)
            VALUES (?,?,?,?,?,?,?,?)`, [studentId, documentType, file.originalname.slice(0, 255), randomUUID(), file.mimetype, file.size, bytes, req.admin.id]);
        await audit(req, "uploaded", "student_document", result.insertId, { studentId, documentType });
        res.status(201).json({ success: true, id: result.insertId });
    } catch (error) { next(error); }
}

export async function downloadDocument(req, res, next) {
    try {
        const [rows] = await pool.execute("SELECT original_name AS originalName,mime_type AS mimeType,file_content AS fileContent FROM student_documents WHERE id=?", [req.params.id]);
        if (!rows.length || !rows[0].fileContent) return res.status(404).json({ success: false, message: "Document not found." });
        res.type(rows[0].mimeType).attachment(rows[0].originalName).send(rows[0].fileContent);
    } catch (error) { next(error); }
}

export async function deleteDocument(req, res, next) {
    try {
        const [result] = await pool.execute("DELETE FROM student_documents WHERE id=?", [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ success: false, message: "Document not found." });
        await audit(req, "deleted", "student_document", req.params.id);
        res.json({ success: true, message: "Document deleted." });
    } catch (error) { next(error); }
}
