import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, logout, me } from "../controllers/authController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, message: "Too many sign-in requests from this network. Please wait and try again." } });

router.post("/login", loginLimiter, login);
router.get("/me", authenticate, me);
router.post("/logout", logout);
export default router;
