import crypto from 'crypto';

export function prepareLectureData(data) {
  const { lectureType, courseId } = data;
  const appLiveBaseUrl = process.env.APP_LIVE_BASE_URL;

  const processedData = { ...data };

  if (lectureType === 'Online') {
    if (!courseId) {
      throw new Error('Course ID is required to generate an Online lecture link.');
    }
    if (!appLiveBaseUrl) {
      console.error('Environment variable APP_LIVE_BASE_URL is missing.');
      throw new Error('Server configuration error.');
    }

    const randomHash = crypto.randomBytes(4).toString('hex');
    const baseUrl = appLiveBaseUrl.endsWith('/') ? appLiveBaseUrl : `${appLiveBaseUrl}/`;
    
    processedData.location = `${baseUrl}${courseId}/${randomHash}`;
  }

  return processedData;
}
