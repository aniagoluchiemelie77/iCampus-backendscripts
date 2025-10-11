import express from "express";
import mongoose from "mongoose";

const router = express.Router();

const eventSchema = new mongoose.Schema({
  createdBy: { type: String, required: true }, // ID of the creator
  creatorType: {
    type: String,
    enum: ["student", "lecturer"],
    required: true,
  },
  title: { type: String, required: true },
  description: { type: String },
  courseTitle: { type: String }, //For lectures
  startDate: { type: String },
  endDate: { type: String },
  eventStartTime: { type: String },
  eventEndTime: { type: String },
  eventType: { type: String }, // e.g., "lecture", "Webinar", or 'other'
  lectureType: { type: String }, // e.g., "online", "physical"
  visibility: {
    type: String,
    enum: ["public", "department", "private"],
    required: true,
  },
  restriction: { type: String, default: "none" }, // For public events: "none" or level (e.g., "300")
  department: { type: String },
  isRecurring: { type: Boolean }, //For repeative private events
  recurrenceRule: { type: String }, // Recurrence rule in iCal format
  level: { type: String }, // For departmental or restricted public events
  userId: { type: String }, // For private events
  location: { type: String },
  tags: { type: [String] }, // Array of tags
  createdAt: { type: String, default: () => new Date().toISOString() },
});

const Event = mongoose.model("Event", eventSchema, "events");

router.get("/", async (req, res) => {
  console.log(req.query);
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

router.post("/", async (req, res) => {
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
