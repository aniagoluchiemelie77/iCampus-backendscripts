import cron from 'node-cron';
import {User} from '../tableDeclarations.js';
import { notifyAdmins } from '../services/adminNotification.js';


cron.schedule('*/5 * * * *', async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const usersToSuspend = await User.find({
    isSuspended: false,
    "suspiciousActivity.timestamp": { $gte: oneHourAgo }
  });

  for (const user of usersToSuspend) {
    const recentFlags = user.suspiciousActivity.filter(a => a.timestamp >= oneHourAgo);
    
    if (recentFlags.length > 5) {
      user.isSuspended = true;
      user.suspiciousActivity = []; 
      await user.save();
      
      await notifyAdmins(
        { role: ["moderator", 'super_admin'] },
        {
          actionType: "ACCOUNT_SUSPENDED_SECURITY",
          payload: { userId: user.uid, reason: "Excessive suspicious activity" },
          senderId: "system"
        },
        true 
      );
    }
  }
});