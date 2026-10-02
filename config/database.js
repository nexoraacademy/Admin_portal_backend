import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const dbName = process.env.DB_NAME || "nexora_academy";
if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error("DB_NAME may only contain letters, numbers and underscores.");

const baseConfig = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
    decimalNumbers: true,
};

export const pool = mysql.createPool({ ...baseConfig, database: dbName });

const schema = [
    `CREATE TABLE IF NOT EXISTS programmes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(160) NOT NULL UNIQUE, description TEXT NULL,
        duration VARCHAR(40) NOT NULL, fee DECIMAL(10,2) NOT NULL DEFAULT 0,
        status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS applicants (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL,
        id_number VARCHAR(30) NOT NULL, date_of_birth DATE NULL, gender VARCHAR(40) NULL,
        phone VARCHAR(40) NOT NULL, email VARCHAR(190) NOT NULL, address TEXT NULL,
        qualification VARCHAR(180) NULL, institution VARCHAR(180) NULL,
        experience TEXT NULL, id_document VARCHAR(255) NULL,
        id_document_data LONGBLOB NULL, id_document_mime VARCHAR(100) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_applicant_id_number (id_number), KEY idx_applicant_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS admin_users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('Super Admin','Administrator','Admissions','Finance') NOT NULL DEFAULT 'Administrator',
        status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
        failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
        locked_until DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS lecturers (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE,
        phone VARCHAR(40) NULL, expertise VARCHAR(255) NULL,
        status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS applications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        applicant_id BIGINT UNSIGNED NOT NULL, programme_id INT UNSIGNED NOT NULL,
        preferred_start_date DATE NULL, motivation TEXT NULL,
        status ENUM('Pending','Under Review','Accepted','Rejected','Waitlisted') NOT NULL DEFAULT 'Pending',
        admin_comment TEXT NULL,
        status_email_sent_at DATETIME NULL, status_email_error VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_application_applicant FOREIGN KEY (applicant_id) REFERENCES applicants(id),
        CONSTRAINT fk_application_programme FOREIGN KEY (programme_id) REFERENCES programmes(id),
        KEY idx_application_status (status), KEY idx_application_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS payments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        application_id BIGINT UNSIGNED NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('Paid','Pending','Failed','Refunded') NOT NULL DEFAULT 'Paid',
        method VARCHAR(60) NOT NULL,
        reference VARCHAR(160) NULL,
        paid_at DATETIME NULL,
        notes VARCHAR(1000) NULL,
        recorded_by INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_payment_application FOREIGN KEY (application_id) REFERENCES applications(id),
        CONSTRAINT fk_payment_admin FOREIGN KEY (recorded_by) REFERENCES admin_users(id) ON DELETE SET NULL,
        KEY idx_payment_status (status), KEY idx_payment_created (created_at), KEY idx_payment_application (application_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS application_history (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        application_id BIGINT UNSIGNED NOT NULL, admin_user_id INT UNSIGNED NULL,
        old_status VARCHAR(30) NULL, new_status VARCHAR(30) NOT NULL,
        comment TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_history_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
        CONSTRAINT fk_history_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
        KEY idx_history_application (application_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS certificates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        certificate_number VARCHAR(40) NOT NULL UNIQUE,
        applicant_id BIGINT UNSIGNED NOT NULL, programme_id INT UNSIGNED NOT NULL,
        completion_date DATE NOT NULL, issue_date DATE NOT NULL,
        status ENUM('Valid','Revoked') NOT NULL DEFAULT 'Valid',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_certificate_applicant FOREIGN KEY (applicant_id) REFERENCES applicants(id),
        CONSTRAINT fk_certificate_programme FOREIGN KEY (programme_id) REFERENCES programmes(id),
        KEY idx_certificate_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS students (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        applicant_id BIGINT UNSIGNED NOT NULL UNIQUE,
        status ENUM('Active','Suspended','Completed','Withdrawn') NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_student_applicant FOREIGN KEY (applicant_id) REFERENCES applicants(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS cohorts (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, programme_id INT UNSIGNED NOT NULL,
        lecturer_id INT UNSIGNED NULL, name VARCHAR(140) NOT NULL, code VARCHAR(40) NOT NULL UNIQUE,
        start_date DATE NULL, end_date DATE NULL,
        status ENUM('Planned','Active','Completed','Suspended','Cancelled') NOT NULL DEFAULT 'Planned',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_cohort_programme FOREIGN KEY (programme_id) REFERENCES programmes(id),
        CONSTRAINT fk_cohort_lecturer FOREIGN KEY (lecturer_id) REFERENCES lecturers(id) ON DELETE SET NULL,
        KEY idx_cohort_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS enrolments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_id BIGINT UNSIGNED NOT NULL, application_id BIGINT UNSIGNED NOT NULL UNIQUE,
        programme_id INT UNSIGNED NOT NULL, cohort_id INT UNSIGNED NULL,
        enrolled_at DATE NOT NULL, start_date DATE NULL,
        status ENUM('Active','Paused','Completed','Withdrawn') NOT NULL DEFAULT 'Active',
        completion_status ENUM('In Progress','Passed','Failed','Not Completed') NOT NULL DEFAULT 'In Progress',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_enrolment_student FOREIGN KEY (student_id) REFERENCES students(id),
        CONSTRAINT fk_enrolment_application FOREIGN KEY (application_id) REFERENCES applications(id),
        CONSTRAINT fk_enrolment_programme FOREIGN KEY (programme_id) REFERENCES programmes(id),
        CONSTRAINT fk_enrolment_cohort FOREIGN KEY (cohort_id) REFERENCES cohorts(id) ON DELETE SET NULL,
        KEY idx_enrolment_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS modules (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, programme_id INT UNSIGNED NOT NULL,
        name VARCHAR(160) NOT NULL, description TEXT NULL, sequence_no INT UNSIGNED NOT NULL DEFAULT 1,
        CONSTRAINT fk_module_programme FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE CASCADE,
        UNIQUE KEY uq_module_programme_sequence (programme_id, sequence_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS lessons (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, module_id INT UNSIGNED NOT NULL,
        title VARCHAR(180) NOT NULL, content MEDIUMTEXT NULL, lesson_order INT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_lesson_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS assessments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, module_id INT UNSIGNED NOT NULL,
        kind ENUM('Assignment','Quiz','Assessment') NOT NULL DEFAULT 'Assignment',
        title VARCHAR(180) NOT NULL, instructions TEXT NULL, due_date DATE NULL,
        max_score DECIMAL(8,2) NOT NULL DEFAULT 100, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_assessment_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS attendance (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, enrolment_id BIGINT UNSIGNED NOT NULL,
        class_date DATE NOT NULL, status ENUM('Present','Absent','Late','Excused') NOT NULL,
        notes VARCHAR(500) NULL, recorded_by INT UNSIGNED NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_attendance_enrolment FOREIGN KEY (enrolment_id) REFERENCES enrolments(id) ON DELETE CASCADE,
        CONSTRAINT fk_attendance_admin FOREIGN KEY (recorded_by) REFERENCES admin_users(id) ON DELETE SET NULL,
        UNIQUE KEY uq_attendance_date (enrolment_id, class_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS results (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, assessment_id BIGINT UNSIGNED NOT NULL,
        enrolment_id BIGINT UNSIGNED NOT NULL, score DECIMAL(8,2) NOT NULL, feedback TEXT NULL,
        graded_by INT UNSIGNED NULL, graded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_result_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
        CONSTRAINT fk_result_enrolment FOREIGN KEY (enrolment_id) REFERENCES enrolments(id) ON DELETE CASCADE,
        CONSTRAINT fk_result_admin FOREIGN KEY (graded_by) REFERENCES admin_users(id) ON DELETE SET NULL,
        UNIQUE KEY uq_result_assessment_enrolment (assessment_id, enrolment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS student_module_progress (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, enrolment_id BIGINT UNSIGNED NOT NULL,
        module_id INT UNSIGNED NOT NULL, progress_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
        status ENUM('Not Started','In Progress','Completed') NOT NULL DEFAULT 'Not Started', updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_progress_enrolment FOREIGN KEY (enrolment_id) REFERENCES enrolments(id) ON DELETE CASCADE,
        CONSTRAINT fk_progress_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE,
        UNIQUE KEY uq_progress_enrolment_module (enrolment_id, module_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS student_documents (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, student_id BIGINT UNSIGNED NOT NULL,
        document_type VARCHAR(80) NOT NULL, original_name VARCHAR(255) NOT NULL,
        stored_name VARCHAR(255) NOT NULL UNIQUE, mime_type VARCHAR(100) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL,
        file_content LONGBLOB NULL,
        uploaded_by INT UNSIGNED NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_document_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        CONSTRAINT fk_document_admin FOREIGN KEY (uploaded_by) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS announcements (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, title VARCHAR(180) NOT NULL,
        body TEXT NOT NULL, audience ENUM('Students','Staff','Everyone') NOT NULL DEFAULT 'Everyone',
        status ENUM('Draft','Published','Archived') NOT NULL DEFAULT 'Draft', published_at DATETIME NULL,
        created_by INT UNSIGNED NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_announcement_admin FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS notifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, announcement_id BIGINT UNSIGNED NOT NULL,
        student_id BIGINT UNSIGNED NULL, lecturer_id INT UNSIGNED NULL, read_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_notification_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
        CONSTRAINT fk_notification_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        CONSTRAINT fk_notification_lecturer FOREIGN KEY (lecturer_id) REFERENCES lecturers(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS academy_settings (
        setting_key VARCHAR(100) NOT NULL PRIMARY KEY, setting_value TEXT NULL,
        updated_by INT UNSIGNED NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_setting_admin FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, admin_user_id INT UNSIGNED NULL,
        action VARCHAR(80) NOT NULL, entity_type VARCHAR(80) NOT NULL, entity_id VARCHAR(80) NULL,
        details JSON NULL, ip_address VARCHAR(45) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_audit_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
        KEY idx_audit_created (created_at), KEY idx_audit_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const initialProgrammes = [
    ["Java Programming Fundamentals", "Learn core Java syntax, object-oriented programming and build practical applications.", "10 weeks", 2500],
    ["Python Programming Fundamentals", "Develop programming foundations and solve practical problems with Python.", "10 weeks", 2500],
    ["Web Development Fundamentals", "Build responsive websites using HTML, CSS and JavaScript.", "12 weeks", 2800],
    ["Database Development & SQL", "Design relational databases and work confidently with SQL.", "10 weeks", 2500],
    ["Mobile App Development", "Learn the foundations of planning and developing mobile applications.", "12 weeks", 3200],
    ["AI Engineering Fundamentals", "Explore programming, data and foundational artificial intelligence concepts.", "12 weeks", 3500],
    ["Full-Stack Web Development", "Build complete web applications across frontend and backend technologies.", "16 weeks", 4500],
];

export async function initializeDatabase() {
    const bootstrap = await mysql.createConnection(baseConfig);
    try { await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
    finally { await bootstrap.end(); }
    for (const statement of schema) await pool.query(statement);
    for (const [column, definition] of [["status_email_sent_at", "DATETIME NULL"], ["status_email_error", "VARCHAR(500) NULL"]]) {
        const [found] = await pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='applications' AND COLUMN_NAME=? LIMIT 1", [dbName, column]);
        if (!found.length) await pool.query(`ALTER TABLE applications ADD COLUMN ${column} ${definition}`);
    }
    for (const [column, definition] of [["id_document_data", "LONGBLOB NULL"], ["id_document_mime", "VARCHAR(100) NULL"]]) {
        const [found] = await pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='applicants' AND COLUMN_NAME=? LIMIT 1", [dbName, column]);
        if (!found.length) await pool.query(`ALTER TABLE applicants ADD COLUMN ${column} ${definition}`);
    }
    const [documentDataColumn] = await pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='student_documents' AND COLUMN_NAME='file_content' LIMIT 1", [dbName]);
    if (!documentDataColumn.length) await pool.query("ALTER TABLE student_documents ADD COLUMN file_content LONGBLOB NULL");
    // Keep legacy application payments readable while all new records attach to enrolments.
    const [paymentAppCol] = await pool.execute("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='payments' AND COLUMN_NAME='application_id'", [dbName]);
    if (paymentAppCol[0]?.IS_NULLABLE === "NO") await pool.query("ALTER TABLE payments MODIFY application_id BIGINT UNSIGNED NULL");
    const [paymentEnrolmentCol] = await pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='payments' AND COLUMN_NAME='enrolment_id' LIMIT 1", [dbName]);
    if (!paymentEnrolmentCol.length) {
        await pool.query("ALTER TABLE payments ADD COLUMN enrolment_id BIGINT UNSIGNED NULL");
        await pool.query("ALTER TABLE payments ADD CONSTRAINT fk_payment_enrolment FOREIGN KEY (enrolment_id) REFERENCES enrolments(id)");
        await pool.query("ALTER TABLE payments ADD KEY idx_payment_enrolment (enrolment_id)");
    }
    const [certificateEnrolmentCol] = await pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='certificates' AND COLUMN_NAME='enrolment_id' LIMIT 1", [dbName]);
    if (!certificateEnrolmentCol.length) {
        await pool.query("ALTER TABLE certificates ADD COLUMN enrolment_id BIGINT UNSIGNED NULL");
        await pool.query("ALTER TABLE certificates ADD CONSTRAINT fk_certificate_enrolment FOREIGN KEY (enrolment_id) REFERENCES enrolments(id) ON DELETE SET NULL");
    }
    for (const [column, definition] of [["failed_login_attempts", "INT UNSIGNED NOT NULL DEFAULT 0"], ["locked_until", "DATETIME NULL"]]) {
        const [found] = await pool.execute("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='admin_users' AND COLUMN_NAME=? LIMIT 1", [dbName, column]);
        if (!found.length) {
            try { await pool.query(`ALTER TABLE admin_users ADD COLUMN ${column} ${definition}`); }
            catch (error) { if (error.code !== "ER_DUP_FIELDNAME") throw error; }
        }
    }
    for (const row of initialProgrammes) {
        await pool.execute("INSERT IGNORE INTO programmes (name, description, duration, fee) VALUES (?, ?, ?, ?)", row);
    }

    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword && adminPassword.length >= 8 && !adminPassword.includes("replace-with") && adminPassword !== "CHANGE_THIS_PASSWORD") {
        const [existing] = await pool.execute("SELECT id FROM admin_users WHERE email = ? LIMIT 1", [adminEmail]);
        if (!existing.length) {
            const hash = await bcrypt.hash(adminPassword, 12);
            await pool.execute("INSERT INTO admin_users (name, email, password_hash, role) VALUES (?, ?, ?, 'Super Admin')", [process.env.ADMIN_NAME || "Nexora Administrator", adminEmail, hash]);
            console.log(`Seeded initial administrator: ${adminEmail}`);
        }
    } else {
        console.warn("Configure ADMIN_EMAIL and an ADMIN_PASSWORD of at least 8 characters in backend/.env; no administrator was seeded.");
    }
}
