import * as deepgramSDK from "@deepgram/sdk";

const deepgram = deepgramSDK.createClient(process.env.DEEPGRAM_API_KEY);

export const processLecturerAudio = async (audioBuffer, lectureId, io) => {
  try {
    // In v3, use .listen.prerecorded
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        smart_format: true,
        language: "en",
        mimetype: "audio/wav",
      },
    );

    if (error) throw error;

    const text = result.results.channels[0].alternatives[0].transcript;
    if (text) {
      io.to(lectureId).emit("transcription_update", { text });
    }
  } catch (error) {
    console.error("AI Transcription Error:", error);
  }
};
export const startLiveTranscription = (socket, io) => {
  const live = deepgram.listen.live({
    model: "nova-2",
    interim_results: true,
    language: "en-US",
  });

  live.on("open", () => {
    console.log("Deepgram pipeline open.");
  });

  live.on("transcript", (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript) {
      // Emit to the specific room (the lecture ID)
      io.emit("live-transcript", transcript);
    }
  });

  // Return the live object so we can send audio to it
  return live;
};
