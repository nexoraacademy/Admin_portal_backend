import { Router } from "express";
import multer from "multer";
import { authenticate, requireRole } from "../middleware/authMiddleware.js";
import { deleteDocument, downloadDocument, listDocuments, uploadDocument } from "../controllers/documentController.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)) return callback(Object.assign(new Error("Only PDF, JPEG or PNG documents are accepted."), { status: 400 }));
    callback(null, true);
} });

router.use(authenticate);
router.get("/", listDocuments);
router.post("/", requireRole("Super Admin", "Administrator", "Admissions"), upload.single("document"), uploadDocument);
router.get("/:id/download", requireRole("Super Admin", "Administrator", "Admissions"), downloadDocument);
router.delete("/:id", requireRole("Super Admin", "Administrator"), deleteDocument);
export default router;
