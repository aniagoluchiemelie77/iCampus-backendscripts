import express from "express";
import { authenticate } from "../index.js";
import { Event } from "../../tableDeclarations.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const { userId, department, level } = req.query;

  if (!userId || !department) {
    return res
      .status(400)
      .json({ error: "Missing userId or department in query" });
  }

  // Build departmental query conditionally
  const departmentQuery = {
    visibility: "department",
    department: department,
  };
  if (level) {
    departmentQuery.level = level;
  }

  // Build public query with level restriction logic
  const publicQuery = {
    visibility: "public",
    $or: [{ restriction: "none" }, ...(level ? [{ restriction: level }] : [])],
  };

  try {
    const events = await Event.find({
      $or: [
        // Public events (for all levels or restricted to user's level)
        publicQuery,

        // Departmental events
        departmentQuery,

        // Private events for the user
        { visibility: "private", userId: userId },
      ],
    });
    res.json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

router.post("/add/", authenticate, async (req, res) => {
  try {
    const newEvent = new Event(req.body);
    await newEvent.save();
    res.status(201).json(newEvent);
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: "Failed to create event" });
  }
});

export default router;
