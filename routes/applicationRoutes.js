import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { authenticate, requireRole } from "../middleware/authMiddleware.js";
import { submitApplication, checkApplicationStatus, simulateDemoPayment, listApplications, getApplication, updateApplication, resendApplicationEmail, getIdentityDocument } from "../controllers/applicationController.js";

const router = Router();
const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) return callback(Object.assign(new Error("Only PDF, JPEG or PNG identity documents are accepted."), { status: 400 }));
    callback(null, true);
} });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, message: "Too many applications from this connection. Please try again later." } });
const statusCheckLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, message: "Too many status checks. Please wait 15 minutes and try again." } });
const demoPaymentLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, message: "Too many demo payment attempts. Try again later." } });

router.post("/", submitLimiter, upload.single("identityDocument"), submitApplication);
router.post("/status-check", statusCheckLimiter, checkApplicationStatus);
router.post("/demo-payment", demoPaymentLimiter, simulateDemoPayment);
router.use(authenticate);
router.get("/", listApplications);
router.get("/:id", getApplication);
router.get("/:id/identity-document/:applicantId", requireRole("Super Admin", "Administrator", "Admissions"), getIdentityDocument);
router.patch("/:id", requireRole("Super Admin", "Administrator", "Admissions"), updateApplication);
router.post("/:id/email", requireRole("Super Admin", "Administrator", "Admissions"), resendApplicationEmail);

export default router;
