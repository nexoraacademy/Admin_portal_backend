import { Router } from "express";
import { authenticate, requireRole } from "../middleware/authMiddleware.js";
import { listCertificates, verifyCertificate, issueCertificate, revokeCertificate } from "../controllers/certificateController.js";

const router = Router();
router.get("/verify/:certificateNumber", verifyCertificate);
router.get("/", authenticate, listCertificates);
router.post("/", authenticate, requireRole("Super Admin", "Administrator"), issueCertificate);
router.patch("/:id/revoke", authenticate, requireRole("Super Admin", "Administrator"), revokeCertificate);
export default router;
