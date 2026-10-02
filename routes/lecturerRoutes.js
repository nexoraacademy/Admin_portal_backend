import { Router } from "express";
import { authenticate, requireRole } from "../middleware/authMiddleware.js";
import { listLecturers, createLecturer, updateLecturer, deleteLecturer } from "../controllers/lecturerController.js";

const router = Router();
router.use(authenticate);
router.get("/", listLecturers);
router.post("/", requireRole("Super Admin", "Administrator"), createLecturer);
router.patch("/:id", requireRole("Super Admin", "Administrator"), updateLecturer);
router.delete("/:id", requireRole("Super Admin", "Administrator"), deleteLecturer);
export default router;
