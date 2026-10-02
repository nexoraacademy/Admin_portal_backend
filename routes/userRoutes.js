import { Router } from "express";
import { authenticate, requireRole } from "../middleware/authMiddleware.js";
import { listUsers, unlockUser } from "../controllers/userController.js";

const router = Router();
router.use(authenticate, requireRole("Super Admin"));
router.get("/", listUsers);
router.patch("/:id/unlock", unlockUser);
export default router;
