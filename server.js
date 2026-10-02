import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { initializeDatabase, pool } from "./config/database.js";
import authRoutes from "./routes/authRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import programmeRoutes from "./routes/programmeRoutes.js";
import certificateRoutes from "./routes/certificateRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import lecturerRoutes from "./routes/lecturerRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import academyRoutes from "./routes/academyRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import { authenticate } from "./middleware/authMiddleware.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

const app = express();
const port = Number(process.env.PORT) || 5000;
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map((origin) => origin.trim());

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("This origin is not allowed by CORS."));
}, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ success: true, status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/programmes", programmeRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/lecturers", lecturerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/academy", academyRoutes);
app.use("/api/documents", documentRoutes);
app.get("/api/students", authenticate, async (_req, res, next) => {
    try {
        const [rows] = await pool.execute(`SELECT s.id, s.id AS studentId, CONCAT(a.first_name, ' ', a.last_name) AS fullName,
            a.email, p.name AS programmeName, s.created_at AS createdAt, s.status
            FROM students s JOIN applicants a ON a.id = s.applicant_id
            JOIN enrolments e ON e.student_id=s.id JOIN programmes p ON p.id=e.programme_id
            ORDER BY s.created_at DESC`);
        res.json({ success: true, data: rows });
    } catch (error) { next(error); }
});
app.use(notFound);
app.use(errorHandler);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes("replace-with") || process.env.JWT_SECRET === "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET") {
    console.error("Set a unique JWT_SECRET of at least 32 characters in backend/.env before starting the API.");
    process.exit(1);
}

initializeDatabase().then(() => {
    const server = app.listen(port, () => console.log(`Nexora Academy API listening on http://localhost:${port}`));
    const shutdown = async () => {
        server.close(async () => {
            await pool.end();
            process.exit(0);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}).catch((error) => {
    console.error("Could not initialize MySQL. Check the database settings in backend/.env.");
    if (process.env.NODE_ENV !== "production") console.error(error.message);
    process.exit(1);
});
