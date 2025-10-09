import express from "express";
import mongoose from "mongoose";

const router = express.Router();

const eventSchema = new mongoose.Schema({
  createdBy: String,
  creatorType: String,
  title: String,
  description: String,
  courseTitle: String,
  startDate: String,
  endDate: String,
  eventType: String,
  lectureType: String,
  visibility: String,
  createdAt: String,
  eventStartTime: String,
  eventEndTime: String,
  location: String,
  tags: String,
});

const Event = mongoose.model("Event", eventSchema, "events");

router.get("/", async (req, res) => {
  console.log(req.query);
  const { userId } = req.query;

  const query = {};
  if (userId) {
    query.userId = userId;
  }

  try {
    const events = await Event.find(query);
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
