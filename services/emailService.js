import nodemailer from "nodemailer";

function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function createTransporter() {
    const host = process.env.SMTP_HOST?.trim();
    const from = process.env.SMTP_FROM_EMAIL?.trim();
    const user = process.env.SMTP_USER?.trim();
    const password = process.env.SMTP_PASSWORD;
    if (!host || !from || !user || !password) throw new Error("SMTP email configuration is missing.");
    const port = Number(process.env.SMTP_PORT) || 587;
    return { from: { name: process.env.SMTP_FROM_NAME || "Nexora Academy", address: from }, transporter: nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465, auth: { user, pass: password } }) };
}

export async function sendApplicationStatusEmail({ to, applicantName, programmeName, status, note = "" }) {
    if (!["Accepted", "Rejected"].includes(status)) throw new Error("Unsupported application email status.");
    const { from, transporter } = createTransporter();
    const accepted = status === "Accepted";
    const title = accepted ? "Your application has been accepted" : "An update on your application";
    const decision = accepted ? "We are pleased to let you know that your application has been accepted." : "We regret to let you know that your application was not accepted at this time.";
    const plainNote = note ? "\n\nMessage from the admissions team:\n" + note : "";
    const htmlNote = note ? '<section style="margin-top:20px;padding:16px;background:#f3f6fb;border-radius:8px"><strong>Message from the admissions team</strong><p style="white-space:pre-wrap">' + escapeHtml(note) + "</p></section>" : "";
    await transporter.sendMail({
        from, to, subject: title + " | Nexora Academy",
        text: "Dear " + applicantName + ",\n\n" + decision + "\n\nProgramme: " + programmeName + plainNote + "\n\nRegards,\nNexora Academy Admissions",
        html: '<main style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1d2b45;line-height:1.6"><h1 style="color:#1458c8">' + escapeHtml(title) + "</h1><p>Dear " + escapeHtml(applicantName) + ",</p><p>" + escapeHtml(decision) + "</p><p><strong>Programme:</strong> " + escapeHtml(programmeName) + "</p>" + htmlNote + '<p style="margin-top:24px">Regards,<br>Nexora Academy Admissions</p></main>',
    });
}
