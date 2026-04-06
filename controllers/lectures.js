import { Lectures, Exceptions, Attendance } from "../tableDeclarations.js";
const lectureRooms = new Map();
export const endLecture = async (lectureId) => {
  await Lectures.update({ id: lectureId }, { status: "completed" });
  const approvedExceptions = await Exceptions.find({
    lectureId,
    status: "approved",
  });
  const attendancePromises = approvedExceptions.map((ex) => {
    return Attendance.upsert({
      studentId: ex.studentId,
      lectureId: lectureId,
      status: "Present",
      remarks: "Verified via Approved Exceptions",
    });
  });
  await Promise.all(attendancePromises);
};
export const updateAttendeeList = (lectureId, user, action) => {
  if (!lectureRooms.has(lectureId)) {
    lectureRooms.set(lectureId, new Map());
  }

  const roomParticipants = lectureRooms.get(lectureId);

  if (action === "join") {
    roomParticipants.set(user.uid, {
      uid: user.uid,
      firstname: user.firstname,
      profilePic: user.profilePic,
      joinedAt: new Date(),
    });
  } else if (action === "leave") {
    roomParticipants.delete(user.uid);
  }
};

export const getAttendeesForRoom = (lectureId) => {
  const room = lectureRooms.get(lectureId);
  return room ? Array.from(room.values()) : [];
};