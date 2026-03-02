import { Router } from "express";
import { SessionModel } from "../models/Session";
import { docToJson } from "../utils/docToJson";

const router = Router();

// GET /api/sessions/:id — load session (read-only, no auth required)
router.get("/sessions/:id", async (req, res) => {
  try {
    const session = await SessionModel.findById(req.params.id);
    if (!session) return res.status(404).json({ error: "Not found" });
    return res.json({ session: docToJson(session) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load session" });
  }
});

export default router;
