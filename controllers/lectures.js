import { Lectures, Exceptions, Attendance } from "../tableDeclarations.js";
export const endLecture = async (lectureId) => {
  await Lectures.update({ id: lectureId }, { status: 'completed' });
  const approvedExceptions = await Exceptions.find({ 
    lectureId, 
    status: 'approved' 
  });
  const attendancePromises = approvedExceptions.map(ex => {
    return Attendance.upsert({
      studentId: ex.studentId,
      lectureId: lectureId,
      status: 'Present',
      remarks: 'Verified via Approved Exceptions'
    });
  });
  await Promise.all(attendancePromises);
};