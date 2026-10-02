import { Router } from "express";
import { authenticate, requireRole } from "../middleware/authMiddleware.js";
import { listPayments, recordPayment, updatePaymentStatus } from "../controllers/paymentController.js";

const router = Router();
router.use(authenticate);
router.get("/", listPayments);
router.post("/", requireRole("Super Admin", "Administrator", "Finance"), recordPayment);
router.patch("/:id", requireRole("Super Admin", "Administrator", "Finance"), updatePaymentStatus);
export default router;
