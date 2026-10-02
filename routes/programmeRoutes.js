import { Router } from "express";
import { authenticate, requireRole } from "../middleware/authMiddleware.js";
import { listProgrammes, createProgramme, updateProgramme, deleteProgramme } from "../controllers/programmeController.js";

const router = Router();
router.get("/manage", authenticate, listProgrammes);
router.get("/", listProgrammes);
router.post("/", authenticate, requireRole("Super Admin", "Administrator"), createProgramme);
router.put("/:id", authenticate, requireRole("Super Admin", "Administrator"), updateProgramme);
router.patch("/:id", authenticate, requireRole("Super Admin", "Administrator"), updateProgramme);
router.delete("/:id", authenticate, requireRole("Super Admin", "Administrator"), deleteProgramme);
export default router;
