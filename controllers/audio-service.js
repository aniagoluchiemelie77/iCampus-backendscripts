import { Deepgram } from '@deepgram/sdk';
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

export const processLecturerAudio = async (audioBuffer, lectureId, io) => {
  const response = await deepgram.transcription.preRecorded(
    { buffer: audioBuffer, mimetype: 'audio/wav' },
    { punctuate: true, language: 'en' }
  );
  try {
    const text = response.results.channels[0].alternatives[0].transcript;
    if (text) {
      io.to(lectureId).emit("transcription_update", { text });
    }
  } catch (error) {
    console.error('AI Transcription Error:', error);
  }
};