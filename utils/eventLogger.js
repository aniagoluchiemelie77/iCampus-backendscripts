import { ControllerLog } from '../tableDeclarations.js';

export const logControllerPerformance = async (controllerName, action, startTime, status, cause = null) => {
  const endTime = Date.now();
  const latency = endTime - startTime;
  
  try {
    await ControllerLog.create({
      controllerName,
      action,
      status,
      cause,
      latency
    });
  } catch (err) {
    console.error("Logger failed to save:", err);
  }
};