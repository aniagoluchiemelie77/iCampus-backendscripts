import {SupportTicket}from '../tableDeclarations.js';
import {createNotification} from '../services/notification.js';
import {generateTicketRefId} from '../utils/idGenerator.js';

export const createTicket = async (req, res) => {
  try {
    const { message, category } = req.body;
    const userId = req.user.uid; 

    const newTicket = await SupportTicket.create({
      userId,
      ticketRefId: generateTicketRefId('technical'), 
      source: "in-app",
      originalMessage: message,
      severity: 'high',
      category,
      thread: [{ sender: userId, message }]
    });
    await createNotification({
      recipientId: userId,
      category: "system",
      actionType: "SUPPORT_TICKET_RECEIVED",
      sendEmail: true, 
      recipientEmail: req.user.email, 
      payload: {
        userName: req.user.name,
        ticketRefId: newTicket.ticketRefId,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString()
      }
    });

    res.status(201).json(newTicket);
  } catch (error) {
    res.status(500).json({ error: "Failed to create ticket" });
  }
};