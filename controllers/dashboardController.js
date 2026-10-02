import { pool } from "../config/database.js";

export async function getDashboard(_req, res, next) {
    try {
        const [[applicationCounts]] = await pool.execute(`SELECT COUNT(*) AS totalApplications,
            SUM(status='Pending') AS pendingApplications, SUM(status='Accepted') AS acceptedApplications,
            SUM(status='Rejected') AS rejectedApplications FROM applications`);
        const [[studentCounts]] = await pool.execute("SELECT COUNT(DISTINCT applicant_id) AS totalStudents FROM applications WHERE status='Accepted'");
        const [[programmeCounts]] = await pool.execute("SELECT COUNT(*) AS activeProgrammes FROM programmes WHERE status='Active'");
        const [[certificateCounts]] = await pool.execute("SELECT COUNT(*) AS certificatesIssued FROM certificates WHERE status='Valid'");
        const [[paymentCounts]] = await pool.execute("SELECT SUM(status='Paid') AS paidPaymentCount, SUM(CASE WHEN status='Paid' THEN amount ELSE 0 END) AS paidAmount, SUM(status='Pending') AS pendingPayments FROM payments");
        const [recentApplications] = await pool.execute(`SELECT ap.id, CONCAT(a.first_name, ' ', a.last_name) AS applicantName,
            p.name AS programmeName, ap.status, ap.created_at AS createdAt
            FROM applications ap JOIN applicants a ON a.id=ap.applicant_id
            JOIN programmes p ON p.id=ap.programme_id ORDER BY ap.created_at DESC LIMIT 8`);
        const numberize = (record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Number(value) || 0]));
        res.json({ success: true, stats: { ...numberize(applicationCounts), ...numberize(studentCounts), ...numberize(programmeCounts), ...numberize(certificateCounts), ...numberize(paymentCounts) }, recentApplications });
    } catch (error) { next(error); }
}
